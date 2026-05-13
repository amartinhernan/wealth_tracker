"""
Universal bank file parser powered by Groq LLM.

Flow:
  1. Read first 30 raw rows from the file (Excel or CSV).
  2. Send them to Groq with a schema-detection prompt.
  3. Groq returns a JSON schema: which row is the header, which columns
     hold date / amount / description, and what date format to expect.
  4. Re-read the file using that schema and return parsed transactions.

Falls back to the rule-based BankParser on any error.
"""

import io
import json
import os

import pandas as pd
from datetime import datetime
from groq import Groq

from .parsers import BankParser

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------
_SCHEMA_PROMPT = """\
You are a bank-statement structure analyser. I will give you the raw content \
(first ≤30 rows) of a bank export file. Your job is to identify its structure \
so that I can extract the transactions correctly.

Return ONLY a valid JSON object with exactly these keys:

{{
  "skip_rows"      : <int>    — 0-indexed row number of the HEADER row.
                               (rows 0..skip_rows-1 are metadata to discard)
  "separator"      : <string> — CSV delimiter: ";", ",", "\\t", or "excel" for Excel files
  "col_date"       : <string> — exact header text of the transaction DATE column
  "col_amount"     : <string|null> — exact header text of the NET amount column
                               (positive = income, negative = expense).
                               null if amounts are split into two columns.
  "col_debit"      : <string|null> — header of DEBIT / CARGO column (positive values = money out).
                               null if using col_amount.
  "col_credit"     : <string|null> — header of CREDIT / ABONO column (positive values = money in).
                               null if using col_amount.
  "col_description": <string> — exact header text of the DESCRIPTION / CONCEPT column
  "date_format"    : <string> — Python strptime format, e.g. "%d/%m/%Y" or "%Y-%m-%d %H:%M:%S"
}}

Rules:
- skip_rows is the row index of the line that contains column NAMES.
  E.g. if rows 0-5 are account info and row 6 has "Fecha;Concepto;Importe", return 6.
- Use the EXACT text of each column header, including any spaces or accents.
- If there is a single net-amount column, fill col_amount and set col_debit/col_credit to null.
- If debits and credits are separate columns, fill col_debit and col_credit and set col_amount to null.
- Ignore balance / running-total columns.

RAW FILE CONTENT (first rows):
{sample}
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _is_excel(file_content: bytes) -> bool:
    return (len(file_content) > 4 and
            file_content[:4] in (b'\xd0\xcf\x11\xe0', b'PK\x03\x04'))


def _extract_sample(file_content: bytes, is_excel: bool) -> str:
    """Return first ≤30 rows as a plain text string for the LLM."""
    try:
        if is_excel:
            df = pd.read_excel(io.BytesIO(file_content), header=None, nrows=30)
            return df.to_csv(index=False, sep='\t', na_rep='')
        for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
            try:
                text = file_content.decode(enc)
                return '\n'.join(text.splitlines()[:30])
            except Exception:
                continue
    except Exception as e:
        print(f'[AIParser] sample extraction error: {e}')
    return ''


def _resolve_col(name: str, df: pd.DataFrame):
    """Return the actual DataFrame column that matches `name`, or None."""
    if not name:
        return None
    if name in df.columns:
        return name
    upper_map = {c.strip().upper(): c for c in df.columns}
    return upper_map.get(name.strip().upper())


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------
class AIParser:

    def __init__(self):
        api_key = os.getenv('GROQ_API_KEY')
        self.client = Groq(api_key=api_key) if api_key else None

    # ------------------------------------------------------------------
    # Schema detection
    # ------------------------------------------------------------------
    def detect_schema(self, sample_text: str) -> dict | None:
        """Ask Groq to identify the file structure. Returns dict or None."""
        if not self.client or not sample_text:
            return None
        prompt = _SCHEMA_PROMPT.format(sample=sample_text[:4500])
        try:
            resp = self.client.chat.completions.create(
                messages=[
                    {
                        'role': 'system',
                        'content': ('You are a precise bank file structure analyser. '
                                    'Return only valid JSON, nothing else.'),
                    },
                    {'role': 'user', 'content': prompt},
                ],
                model='llama-3.3-70b-versatile',
                response_format={'type': 'json_object'},
                temperature=0,
                max_tokens=512,
            )
            schema = json.loads(resp.choices[0].message.content)
            if all(k in schema for k in ('skip_rows', 'col_date', 'col_description')):
                print(f'[AIParser] schema detected: {json.dumps(schema)}')
                return schema
            print(f'[AIParser] schema missing required keys: {schema}')
        except Exception as e:
            print(f'[AIParser] schema detection error: {e}')
        return None

    # ------------------------------------------------------------------
    # File reading
    # ------------------------------------------------------------------
    def _read_file(self, file_content: bytes, schema: dict, is_excel: bool) -> pd.DataFrame:
        skip = max(0, int(schema.get('skip_rows', 0)))
        try:
            if is_excel:
                df = pd.read_excel(io.BytesIO(file_content), skiprows=skip)
            else:
                sep = str(schema.get('separator', ',')).strip()
                if sep in ('excel', ''):
                    sep = ','
                df = pd.DataFrame()
                for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
                    try:
                        candidate = pd.read_csv(
                            io.BytesIO(file_content), skiprows=skip,
                            sep=sep, encoding=enc, on_bad_lines='skip'
                        )
                        if len(candidate.columns) > 1:
                            df = candidate
                            break
                    except Exception:
                        continue
            # Normalise column names
            df.columns = [str(c).strip() for c in df.columns]
            return df
        except Exception as e:
            print(f'[AIParser] read_file error: {e}')
            return pd.DataFrame()

    # ------------------------------------------------------------------
    # Row → transaction dict
    # ------------------------------------------------------------------
    def _apply_schema(self, df: pd.DataFrame, schema: dict, source: str) -> list:
        col_date   = _resolve_col(schema.get('col_date', ''), df)
        col_amount = _resolve_col(schema.get('col_amount', ''), df)
        col_debit  = _resolve_col(schema.get('col_debit', ''), df)
        col_credit = _resolve_col(schema.get('col_credit', ''), df)
        col_desc   = _resolve_col(schema.get('col_description', ''), df)
        date_fmt   = schema.get('date_format')

        if not col_date or not col_desc:
            print(f'[AIParser] cannot resolve date ({col_date}) or desc ({col_desc}) columns')
            return []

        fmts = [date_fmt] if date_fmt else None
        results = []
        for _, row in df.iterrows():
            try:
                desc = row.get(col_desc)
                if desc is None or (isinstance(desc, float) and pd.isna(desc)):
                    continue
                desc_str = str(desc).strip().strip('"')
                if not desc_str or desc_str.lower() in ('nan', 'none', ''):
                    continue

                # Amount
                if col_amount:
                    amount = BankParser._parse_amount(row.get(col_amount, 0))
                elif col_debit and col_credit:
                    debit  = BankParser._parse_amount(row.get(col_debit,  0))
                    credit = BankParser._parse_amount(row.get(col_credit, 0))
                    amount = credit - debit
                else:
                    continue

                # Date
                date_val = row.get(col_date, '')
                date_obj = BankParser._parse_date(date_val, fmts)

                results.append({
                    'date':        date_obj,
                    'description': desc_str,
                    'amount':      amount,
                    'source':      source,
                    'raw_text':    str(row.to_dict()),
                    'is_income':   amount > 0,
                })
            except Exception as e:
                print(f'[AIParser] row error: {e}')

        return results

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------
    def parse_universal(self, file_content: bytes, source: str) -> list:
        """
        Detect schema via Groq and parse the file.
        Returns list of transaction dicts (same shape as BankParser outputs).
        Returns empty list if detection or parsing fails.
        """
        is_excel = _is_excel(file_content)
        sample   = _extract_sample(file_content, is_excel)
        if not sample:
            return []

        schema = self.detect_schema(sample)
        if not schema:
            return []

        df = self._read_file(file_content, schema, is_excel)
        if df.empty:
            return []

        return self._apply_schema(df, schema, source)
