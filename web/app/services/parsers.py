import pandas as pd
import io
from datetime import datetime


class BankParser:

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _find_header_row(file_content, target_columns, is_excel=True, sep=None):
        """Find the row index containing all target column headers (case-insensitive)."""
        seps = [sep] if sep else ([';', ',', '\t'] if not is_excel else [None])
        for s in seps:
            try:
                if is_excel:
                    df_test = pd.read_excel(io.BytesIO(file_content), header=None, nrows=20)
                else:
                    for enc in ['utf-8-sig', 'utf-8', 'latin-1']:
                        try:
                            kwargs = dict(header=None, nrows=20, encoding=enc)
                            if s: kwargs['sep'] = s
                            df_test = pd.read_csv(io.BytesIO(file_content), **kwargs)
                            if len(df_test.columns) > 1:
                                break
                        except Exception:
                            continue

                for i, row in df_test.iterrows():
                    row_str = ' '.join(str(v).upper() for v in row.values if not pd.isna(v))
                    if all(col.upper() in row_str for col in target_columns):
                        return i
            except Exception as e:
                print(f'Header search error (sep={s}): {e}')
        return None

    @staticmethod
    def _parse_amount(val):
        """Convert European or standard amount string/number to float."""
        if val is None:
            return 0.0
        if isinstance(val, float) and pd.isna(val):
            return 0.0
        if isinstance(val, (int, float)):
            return float(val)
        s = (str(val).strip()
             .replace('\xa0', '').replace(' ', '').replace(' ', '')
             .replace('−', '-')   # unicode minus sign → ASCII hyphen
             .replace('–', '-')   # en-dash → hyphen
             .replace(' ', '').replace('+', '')
             .replace('"', '').replace("'", ''))
        if not s or s in ('-', '—', '–'):
            return 0.0
        # European: 1.234,56  →  standard: 1234.56
        if ',' in s and '.' in s:
            if s.rfind(',') > s.rfind('.'):
                s = s.replace('.', '').replace(',', '.')
            else:
                s = s.replace(',', '')
        elif ',' in s:
            s = s.replace('.', '').replace(',', '.')
        try:
            return float(s)
        except ValueError:
            return 0.0

    @staticmethod
    def _parse_date(val, formats=None):
        """Parse date from datetime objects, pandas Timestamps, or strings."""
        if val is None:
            return datetime.now()
        if isinstance(val, datetime):
            return val
        if hasattr(val, 'to_pydatetime'):
            return val.to_pydatetime()
        if hasattr(val, 'year'):
            return datetime(val.year, val.month, val.day)
        s = str(val).strip()
        if not s or s in ('nan', 'NaT', 'None'):
            return datetime.now()
        s = s[:19]
        all_fmts = formats or [
            '%d/%m/%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S',
            '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%d.%m.%Y', '%d/%m/%y',
        ]
        for fmt in all_fmts:
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        return datetime.now()

    @staticmethod
    def _read_excel(file_content, header_idx, fallback=0):
        idx = header_idx if header_idx is not None else fallback
        return pd.read_excel(io.BytesIO(file_content), skiprows=idx)

    @staticmethod
    def _read_csv(file_content, header_idx=0, sep=','):
        for enc in ['utf-8-sig', 'utf-8', 'latin-1']:
            try:
                return pd.read_csv(io.BytesIO(file_content), skiprows=header_idx, sep=sep, encoding=enc)
            except Exception:
                continue
        return pd.DataFrame()

    # ── Revolut ──────────────────────────────────────────────────────────────

    @staticmethod
    def parse_revolut(file_content):
        df = BankParser._read_csv(file_content)
        results = []
        for _, row in df.iterrows():
            try:
                state = row.get('State', row.get('Status', 'COMPLETADO'))
                if str(state).upper() not in ('COMPLETADO', 'COMPLETED', 'NAN'):
                    continue
                amount = BankParser._parse_amount(row.get('Importe', row.get('Amount', 0)))
                date_obj = BankParser._parse_date(
                    row.get('Fecha de inicio', row.get('Started Date', '')),
                    ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d']
                )
                desc = str(row.get('Descripción', row.get('Description', '')))
                results.append({'date': date_obj, 'description': desc, 'amount': amount,
                                'source': 'REVOLUT', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Revolut row error: {e}')
        return results

    # ── Santander ─────────────────────────────────────────────────────────────
    # Desktop: .xls/.xlsx Excel (magic bytes D0CF or PK)
    # Mobile:  .csv (semicolon or tab-separated, may have BOM)

    @staticmethod
    def parse_santander(file_content):
        # Detect binary Excel vs text CSV by magic bytes
        is_excel = (len(file_content) > 4 and
                    file_content[:4] in (b'\xd0\xcf\x11\xe0', b'PK\x03\x04'))

        if is_excel:
            hidx = BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE'])
            df = BankParser._read_excel(file_content, hidx, fallback=7)
        else:
            # Mobile / web CSV export: detect separator from file sample
            try:
                sample = file_content[:4000].decode('utf-8-sig', errors='replace')
            except Exception:
                sample = ''
            # Count delimiters to pick the most likely one
            sep = ';'
            for candidate in [';', '\t', ',']:
                if sample.count(candidate) > sample.count(sep):
                    sep = candidate

            # Find header row (look for any known column combination)
            hidx = None
            for cols in [['CONCEPTO', 'IMPORTE'], ['FECHA', 'IMPORTE'],
                         ['DESCRIPCION', 'IMPORTE'], ['DESCRIPCIÓN', 'IMPORTE'],
                         ['CONCEPTO', 'SALDO']]:
                hidx = BankParser._find_header_row(file_content, cols,
                                                   is_excel=False, sep=sep)
                if hidx is not None:
                    break

            df = BankParser._read_csv(file_content, header_idx=hidx or 0, sep=sep)
            # Strip quotes that Santander wraps around column names
            df.columns = [str(c).strip().strip('"').strip() for c in df.columns]

        if df.empty:
            return []

        # Build case-insensitive column map (strip quotes from key)
        cols_u = {str(c).upper().strip().strip('"').strip(): c for c in df.columns}

        results = []
        for _, row in df.iterrows():
            try:
                desc_key = (cols_u.get('CONCEPTO') or cols_u.get('CONCEPTO AMPLIADO') or
                            cols_u.get('DESCRIPCIÓN') or cols_u.get('DESCRIPCION') or
                            cols_u.get('DETALLE') or cols_u.get('MOVIMIENTO'))
                desc = row.get(desc_key) if desc_key else None
                if desc is None or (isinstance(desc, float) and pd.isna(desc)):
                    continue
                desc_str = str(desc).strip().strip('"')
                if not desc_str or desc_str.lower() in ('nan', 'none', ''):
                    continue

                amt_key = (cols_u.get('IMPORTE EUR') or cols_u.get('IMPORTE (€)') or
                           cols_u.get('IMPORTE(€)') or cols_u.get('IMPORTE (EUR)') or
                           cols_u.get('IMPORTE') or cols_u.get('CARGO/ABONO') or
                           cols_u.get('IMPORTE €'))
                amount = BankParser._parse_amount(row.get(amt_key, 0) if amt_key else 0)

                date_key = (cols_u.get('FECHA OPERACIÓN') or cols_u.get('FECHA OPERACION') or
                            cols_u.get('FECHA MOV.') or cols_u.get('FECHA MOV') or
                            cols_u.get('FECHA OPER.') or cols_u.get('FECHA'))
                date_val = str(row.get(date_key, '') if date_key else '').strip().strip('"')
                date_obj = BankParser._parse_date(date_val)

                results.append({'date': date_obj, 'description': desc_str, 'amount': amount,
                                'source': 'SANTANDER', 'raw_text': str(row.to_dict()),
                                'is_income': amount > 0})
            except Exception as e:
                print(f'Santander row error: {e}')
        return results

    # ── BBVA ──────────────────────────────────────────────────────────────────
    # Format: Excel, ~4 metadata rows, then headers:
    #   F.Operación | F.Valor | Concepto | Importe | Disponible
    # Some exports have separate Cargo/Abono columns instead of Importe.

    @staticmethod
    def parse_bbva(file_content):
        hidx = (BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['FECHA', 'CONCEPTO']))
        df = BankParser._read_excel(file_content, hidx, fallback=4)
        cols_u = {str(c).upper().strip(): c for c in df.columns}
        results = []
        for _, row in df.iterrows():
            try:
                desc_col = (cols_u.get('CONCEPTO') or cols_u.get('DESCRIPCIÓN')
                            or cols_u.get('DESCRIPCION'))
                desc = row.get(desc_col) if desc_col else None
                if desc is None or pd.isna(desc): continue
                # Some BBVA exports split into Cargo (debit) and Abono (credit)
                if 'CARGO' in cols_u:
                    cargo = BankParser._parse_amount(row.get(cols_u['CARGO'], 0))
                    abono = BankParser._parse_amount(row.get(cols_u.get('ABONO', ''), 0))
                    amount = abono - cargo
                else:
                    amount = BankParser._parse_amount(
                        row.get(cols_u.get('IMPORTE', ''), row.get('Importe', 0)))
                date_col = (cols_u.get('F.OPERACIÓN') or cols_u.get('F.OPERACION')
                            or cols_u.get('FECHA') or cols_u.get('FECHA OPERACIÓN'))
                date_obj = BankParser._parse_date(row.get(date_col, '') if date_col else '')
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'BBVA', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'BBVA row error: {e}')
        return results

    # ── CaixaBank ─────────────────────────────────────────────────────────────
    # Format: Excel, 3-6 metadata rows, then headers:
    #   Fecha | Concepto | Importe | Saldo

    @staticmethod
    def parse_caixabank(file_content):
        hidx = (BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['FECHA', 'IMPORTE']))
        df = BankParser._read_excel(file_content, hidx, fallback=5)
        cols_u = {str(c).upper().strip(): c for c in df.columns}
        results = []
        for _, row in df.iterrows():
            try:
                desc_col = (cols_u.get('CONCEPTO') or cols_u.get('DESCRIPCION')
                            or cols_u.get('DESCRIPCIÓN') or cols_u.get('DESCRIPCIO'))
                desc = row.get(desc_col) if desc_col else None
                if desc is None or pd.isna(desc): continue
                amount = BankParser._parse_amount(
                    row.get(cols_u.get('IMPORTE', ''), row.get('Importe', 0)))
                date_col = cols_u.get('FECHA') or cols_u.get('DATA')
                date_obj = BankParser._parse_date(row.get(date_col, '') if date_col else '')
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'CAIXABANK', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'CaixaBank row error: {e}')
        return results

    # ── Sabadell ──────────────────────────────────────────────────────────────
    # Format: Excel, ~5 metadata rows, then headers:
    #   Fecha Operación | Fecha Valor | Descripción | Cargo | Abono | Saldo
    # Cargo = debit (positive), Abono = credit (positive) → amount = Abono - Cargo

    @staticmethod
    def parse_sabadell(file_content):
        hidx = (BankParser._find_header_row(file_content, ['DESCRIPCION', 'CARGO'])
                or BankParser._find_header_row(file_content, ['DESCRIPCIÓN', 'ABONO']))
        df = BankParser._read_excel(file_content, hidx, fallback=5)
        cols_u = {str(c).upper().strip(): c for c in df.columns}
        results = []
        for _, row in df.iterrows():
            try:
                desc_col = (cols_u.get('DESCRIPCIÓN') or cols_u.get('DESCRIPCION')
                            or cols_u.get('CONCEPTO'))
                desc = row.get(desc_col) if desc_col else None
                if desc is None or pd.isna(desc): continue
                cargo_col = cols_u.get('CARGO') or cols_u.get('CARGO EUR')
                abono_col = cols_u.get('ABONO') or cols_u.get('ABONO EUR')
                if cargo_col and abono_col:
                    cargo = BankParser._parse_amount(row.get(cols_u[cargo_col], 0) if cargo_col in cols_u else row.get(cargo_col, 0))
                    abono = BankParser._parse_amount(row.get(cols_u[abono_col], 0) if abono_col in cols_u else row.get(abono_col, 0))
                    amount = abono - cargo
                else:
                    amount = BankParser._parse_amount(row.get('IMPORTE', row.get('Importe', 0)))
                date_col = (cols_u.get('FECHA OPERACIÓN') or cols_u.get('FECHA OPERACION')
                            or cols_u.get('FECHA'))
                date_obj = BankParser._parse_date(row.get(date_col, '') if date_col else '')
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'SABADELL', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Sabadell row error: {e}')
        return results

    # ── ING ───────────────────────────────────────────────────────────────────
    # Format: Excel, clean from row 1:
    #   Fecha | F.Valor | Categoría | Subcategoría | Descripción | Comentario | Imagen | Importe (€)

    @staticmethod
    def parse_ing(file_content):
        hidx = (BankParser._find_header_row(file_content, ['DESCRIPCIÓN', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['FECHA', 'IMPORTE']))
        df = BankParser._read_excel(file_content, hidx, fallback=1)
        results = []
        for _, row in df.iterrows():
            try:
                desc = row.get('Descripción', row.get('DESCRIPCIÓN', row.get('Concepto', '')))
                if pd.isna(desc): continue
                # ING uses "Importe (€)" as the column name
                amount_col = next((c for c in df.columns if 'IMPORTE' in str(c).upper()), None)
                amount = BankParser._parse_amount(row.get(amount_col, 0) if amount_col else 0)
                date_obj = BankParser._parse_date(row.get('Fecha', row.get('FECHA', '')))
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'ING', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'ING row error: {e}')
        return results

    # ── Bankinter ─────────────────────────────────────────────────────────────
    # Format: Excel, ~3 metadata rows, then headers:
    #   FECHA OPERACIÓN | FECHA VALOR | CONCEPTO | IMPORTE | SALDO

    @staticmethod
    def parse_bankinter(file_content):
        hidx = BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE'])
        df = BankParser._read_excel(file_content, hidx, fallback=3)
        cols_u = {str(c).upper().strip(): c for c in df.columns}
        results = []
        for _, row in df.iterrows():
            try:
                desc_col = cols_u.get('CONCEPTO') or cols_u.get('DESCRIPCIÓN')
                desc = row.get(desc_col) if desc_col else None
                if desc is None or pd.isna(desc): continue
                amount = BankParser._parse_amount(
                    row.get(cols_u.get('IMPORTE', ''), row.get('Importe', 0)))
                date_col = cols_u.get('FECHA OPERACIÓN') or cols_u.get('FECHA OPERACION') or cols_u.get('FECHA')
                date_obj = BankParser._parse_date(row.get(date_col, '') if date_col else '')
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'BANKINTER', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Bankinter row error: {e}')
        return results

    # ── Openbank ──────────────────────────────────────────────────────────────
    # Format: Excel (Santander Group), ~5 metadata rows, then:
    #   Fecha Operación | Fecha Valor | Concepto | Importe | Saldo

    @staticmethod
    def parse_openbank(file_content):
        hidx = BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE'])
        df = BankParser._read_excel(file_content, hidx, fallback=5)
        cols_u = {str(c).upper().strip(): c for c in df.columns}
        results = []
        for _, row in df.iterrows():
            try:
                desc_col = cols_u.get('CONCEPTO') or cols_u.get('DESCRIPCIÓN')
                desc = row.get(desc_col) if desc_col else None
                if desc is None or pd.isna(desc): continue
                amount = BankParser._parse_amount(
                    row.get(cols_u.get('IMPORTE', ''), row.get('Importe', 0)))
                date_col = (cols_u.get('FECHA OPERACIÓN') or cols_u.get('FECHA OPERACION')
                            or cols_u.get('FECHA'))
                date_obj = BankParser._parse_date(row.get(date_col, '') if date_col else '')
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'OPENBANK', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Openbank row error: {e}')
        return results

    # ── N26 ───────────────────────────────────────────────────────────────────
    # Format: CSV (semicolon-separated in Spanish), headers on row 0:
    #   Fecha | Beneficiario | Número de cuenta | Tipo de transacción |
    #   Referencia de pago | Categoría | Cantidad (EUR) | Saldo del extracto (EUR)

    @staticmethod
    def parse_n26(file_content):
        df = pd.DataFrame()
        for sep in [';', ',']:
            for enc in ['utf-8-sig', 'utf-8', 'latin-1']:
                try:
                    candidate = pd.read_csv(io.BytesIO(file_content), sep=sep, encoding=enc)
                    if len(candidate.columns) >= 4:
                        df = candidate
                        break
                except Exception:
                    continue
            if not df.empty:
                break

        results = []
        for _, row in df.iterrows():
            try:
                desc = row.get('Beneficiario', row.get('Payee', ''))
                if pd.isna(desc) or not str(desc).strip():
                    desc = row.get('Referencia de pago', row.get('Payment reference', ''))
                if pd.isna(desc): continue
                amount_col = next((c for c in df.columns
                                   if 'CANTIDAD' in str(c).upper() or 'AMOUNT' in str(c).upper()), None)
                amount = BankParser._parse_amount(row.get(amount_col, 0) if amount_col else 0)
                date_obj = BankParser._parse_date(
                    row.get('Fecha', row.get('Date', '')),
                    ['%Y-%m-%d', '%d/%m/%Y', '%d.%m.%Y']
                )
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'N26', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'N26 row error: {e}')
        return results

    # ── Wise ──────────────────────────────────────────────────────────────────
    # Format: CSV (comma-separated), headers on row 0:
    #   ID | Date | Amount | Currency | Description | Payment Reference |
    #   Running Balance | Exchange From | Exchange To | Exchange Rate | ...

    @staticmethod
    def parse_wise(file_content):
        df = pd.DataFrame()
        for enc in ['utf-8-sig', 'utf-8', 'latin-1']:
            try:
                df = pd.read_csv(io.BytesIO(file_content), encoding=enc)
                if not df.empty:
                    break
            except Exception:
                continue

        results = []
        for _, row in df.iterrows():
            try:
                desc = row.get('Description', row.get('Merchant', row.get('Payee Name', '')))
                ref = row.get('Payment Reference', '')
                if not pd.isna(ref) and str(ref).strip():
                    desc = f'{desc} — {ref}' if not pd.isna(desc) else ref
                if pd.isna(desc): continue
                # Use "Amount" column but avoid fee/exchange columns
                amount_col = next((c for c in df.columns
                                   if 'AMOUNT' in str(c).upper()
                                   and 'FEE' not in str(c).upper()
                                   and 'EXCHANGE' not in str(c).upper()
                                   and 'SOURCE' not in str(c).upper()
                                   and 'TARGET' not in str(c).upper()), None)
                amount = BankParser._parse_amount(row.get(amount_col, 0) if amount_col else 0)
                date_obj = BankParser._parse_date(
                    row.get('Date', ''),
                    ['%d-%m-%Y', '%Y-%m-%d', '%d/%m/%Y']
                )
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'WISE', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Wise row error: {e}')
        return results

    # ── Generic Spanish Bank (Excel) ─────────────────────────────────────────
    # Covers: Abanca, Kutxabank, Unicaja, Ibercaja, Cajamar, EVO Banco, MyInvestor
    # All share the same standard format: Fecha | Concepto/Descripción | Importe | Saldo
    # Some also have Cargo/Abono split columns.

    @staticmethod
    def _generic_excel_parser(file_content, source):
        hidx = (BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['DESCRIPCION', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['DESCRIPCIÓN', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['MOVIMIENTO', 'IMPORTE'])
                or BankParser._find_header_row(file_content, ['FECHA', 'IMPORTE']))
        df = BankParser._read_excel(file_content, hidx, fallback=5)
        cols_u = {str(c).upper().strip(): c for c in df.columns}
        results = []
        for _, row in df.iterrows():
            try:
                desc_col = (cols_u.get('CONCEPTO') or cols_u.get('DESCRIPCIÓN')
                            or cols_u.get('DESCRIPCION') or cols_u.get('MOVIMIENTO'))
                desc = row.get(desc_col) if desc_col else None
                if desc is None or pd.isna(desc):
                    continue
                if 'CARGO' in cols_u and 'ABONO' in cols_u:
                    cargo = BankParser._parse_amount(row.get(cols_u['CARGO'], 0))
                    abono = BankParser._parse_amount(row.get(cols_u['ABONO'], 0))
                    amount = abono - cargo
                else:
                    amt_col = (cols_u.get('IMPORTE') or cols_u.get('IMPORTE EUR')
                               or cols_u.get('CANTIDAD'))
                    amount = BankParser._parse_amount(row.get(amt_col, 0) if amt_col else 0)
                date_col = (cols_u.get('FECHA OPERACIÓN') or cols_u.get('FECHA OPERACION')
                            or cols_u.get('FECHA'))
                date_obj = BankParser._parse_date(row.get(date_col, '') if date_col else '')
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': source, 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'{source} row error: {e}')
        return results

    @staticmethod
    def parse_abanca(f):     return BankParser._generic_excel_parser(f, 'ABANCA')
    @staticmethod
    def parse_kutxabank(f):  return BankParser._generic_excel_parser(f, 'KUTXABANK')
    @staticmethod
    def parse_unicaja(f):    return BankParser._generic_excel_parser(f, 'UNICAJA')
    @staticmethod
    def parse_ibercaja(f):   return BankParser._generic_excel_parser(f, 'IBERCAJA')
    @staticmethod
    def parse_cajamar(f):    return BankParser._generic_excel_parser(f, 'CAJAMAR')
    @staticmethod
    def parse_evobank(f):    return BankParser._generic_excel_parser(f, 'EVOBANK')
    @staticmethod
    def parse_myinvestor(f): return BankParser._generic_excel_parser(f, 'MYINVESTOR')

    # ── Trade Republic ────────────────────────────────────────────────────────
    # Format: CSV (comma or semicolon), headers on row 0.
    # Cash account export: Fecha | Tipo | Referencia | Descripción | Importe (EUR)
    # Trade/investment export adds: Acciones | Precio | Moneda | ISIN | ...

    @staticmethod
    def parse_traderepublic(file_content):
        df = pd.DataFrame()
        for sep in [',', ';']:
            for enc in ['utf-8-sig', 'utf-8', 'latin-1']:
                try:
                    candidate = pd.read_csv(io.BytesIO(file_content), sep=sep, encoding=enc)
                    if len(candidate.columns) >= 3:
                        df = candidate
                        break
                except Exception:
                    continue
            if not df.empty:
                break

        results = []
        for _, row in df.iterrows():
            try:
                # Description: look for Spanish or German column
                desc_col = next((c for c in df.columns if any(
                    k in str(c).upper() for k in ['DESCRIPCI', 'DESCRIPTION', 'TITEL', 'TYP', 'TYPE']
                )), None)
                desc = str(row.get(desc_col, '')) if desc_col else ''
                if not desc or pd.isna(row.get(desc_col, None)):
                    continue
                # Amount: prefer the EUR net column
                amt_col = next((c for c in df.columns if any(
                    k in str(c).upper() for k in ['NETTO', 'NET', 'TOTAL', 'BETRAG', 'IMPORTE', 'AMOUNT']
                )), None)
                amount = BankParser._parse_amount(row.get(amt_col, 0) if amt_col else 0)
                # Date
                date_col = next((c for c in df.columns if any(
                    k in str(c).upper() for k in ['DATUM', 'DATE', 'FECHA']
                )), None)
                date_obj = BankParser._parse_date(
                    row.get(date_col, '') if date_col else '',
                    ['%Y-%m-%d', '%d/%m/%Y', '%d.%m.%Y', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S']
                )
                results.append({'date': date_obj, 'description': desc, 'amount': amount,
                                'source': 'TRADEREPUBLIC', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Trade Republic row error: {e}')
        return results

    # ── Edenred ───────────────────────────────────────────────────────────────

    @staticmethod
    def parse_edenred(file_content):
        hidx = BankParser._find_header_row(file_content, ['Detalle movimiento', 'Importe'])
        df = BankParser._read_excel(file_content, hidx, fallback=8)
        results = []
        for _, row in df.iterrows():
            try:
                desc = row.get('Detalle movimiento', row.get('Concepto'))
                if pd.isna(desc): continue
                amount = BankParser._parse_amount(row.get('Importe', 0))
                date_obj = BankParser._parse_date(row.get('Fecha', ''))
                amount = abs(amount) if 'RECARGA' in str(desc).upper() else -abs(amount)
                results.append({'date': date_obj, 'description': str(desc), 'amount': amount,
                                'source': 'EDENRED', 'raw_text': str(row.to_dict()), 'is_income': amount > 0})
            except Exception as e:
                print(f'Edenred row error: {e}')
        return results
