import pandas as pd
import io
import re
from datetime import datetime

class BankParser:
    @staticmethod
    def _find_header_row(file_content, target_columns, is_excel=True):
        """Busca la fila que contiene las cabeceras deseadas."""
        try:
            if is_excel:
                # Leemos las primeras 20 filas para buscar la cabecera
                df_test = pd.read_excel(io.BytesIO(file_content), header=None, nrows=20)
            else:
                df_test = pd.read_csv(io.BytesIO(file_content), header=None, nrows=20)
            
            for i, row in df_test.iterrows():
                row_str = " ".join([str(v).upper() for v in row.values if not pd.isna(v)])
                if all(col.upper() in row_str for col in target_columns):
                    return i
        except Exception as e:
            print(f"Error searching for header: {e}")
        return None

    @staticmethod
    def parse_revolut(file_content):
        # Revolut: Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo
        df = pd.read_csv(io.BytesIO(file_content))
        transactions = []
        for _, row in df.iterrows():
            try:
                # Filtrar solo completados si existe la columna State
                if 'State' in row and row['State'] != 'COMPLETADO':
                    continue
                
                amount = float(row['Importe'])
                date_str = row['Fecha de inicio']
                # Formato: 2023-08-04 22:20:20
                date_obj = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                
                transactions.append({
                    'date': date_obj,
                    'description': str(row['Descripción']),
                    'amount': amount,
                    'source': 'REVOLUT',
                    'raw_text': str(row.to_dict()),
                    'is_income': amount > 0
                })
            except Exception as e:
                print(f"Error parsing Revolut row: {e}")
        return transactions

    @staticmethod
    def parse_santander(file_content):
        # Santander: FECHA OPERACIÓN, FECHA VALOR, CONCEPTO, IMPORTE EUR, SALDO
        header_idx = BankParser._find_header_row(file_content, ['CONCEPTO', 'IMPORTE EUR'])
        
        if header_idx is None:
            # Reintento con nombres de columnas alternativos o asumiendo el antiguo
            header_idx = 7 
            
        df = pd.read_excel(io.BytesIO(file_content), skiprows=header_idx)
        transactions = []
        for _, row in df.iterrows():
            try:
                desc = row.get('CONCEPTO', row.get('Concepto'))
                if pd.isna(desc): continue
                
                # Importe puede venir con coma
                amount_raw = row.get('IMPORTE EUR', row.get('Importe', 0))
                if isinstance(amount_raw, str):
                    amount = float(amount_raw.replace('.', '').replace(',', '.'))
                else:
                    amount = float(amount_raw)
                
                date_raw = row.get('FECHA OPERACIÓN', row.get('Fecha', datetime.now()))
                if isinstance(date_raw, str):
                    date_obj = datetime.strptime(date_raw, '%d/%m/%Y')
                else:
                    date_obj = date_raw # Pandas suele detectarlo
                
                transactions.append({
                    'date': date_obj,
                    'description': str(desc),
                    'amount': amount,
                    'source': 'SANTANDER',
                    'raw_text': str(row.to_dict()),
                    'is_income': amount > 0
                })
            except Exception as e:
                print(f"Error parsing Santander row: {e}")
        return transactions

    @staticmethod
    def parse_edenred(file_content):
        # Edenred: Fecha, Detalle movimiento, Importe
        header_idx = BankParser._find_header_row(file_content, ['Detalle movimiento', 'Importe'])
        
        if header_idx is None:
            header_idx = 8
            
        df = pd.read_excel(io.BytesIO(file_content), skiprows=header_idx)
        transactions = []
        for _, row in df.iterrows():
            try:
                desc = row.get('Detalle movimiento', row.get('Concepto'))
                if pd.isna(desc): continue
                
                amount_raw = row.get('Importe', 0)
                if isinstance(amount_raw, str):
                    amount = float(amount_raw.replace('.', '').replace(',', '.'))
                else:
                    amount = float(amount_raw)
                
                date_raw = row.get('Fecha', datetime.now())
                if isinstance(date_raw, str):
                    # Intentar múltiples formatos comunes en Edenred
                    for fmt in ['%Y-%m-%d %H:%M:%S', '%d/%m/%Y %H:%M:%S', '%d/%m/%Y']:
                        try:
                            date_obj = datetime.strptime(date_raw, fmt)
                            break
                        except:
                            continue
                    else:
                        date_obj = datetime.now()
                else:
                    date_obj = date_raw
                
                # Lógica de Signo: En Edenred los gastos suelen venir en positivo. 
                # Invertimos si NO es una recarga.
                if "RECARGA" not in str(desc).upper():
                    amount = -abs(amount)
                else:
                    amount = abs(amount)

                transactions.append({
                    'date': date_obj,
                    'description': str(desc),
                    'amount': amount,
                    'source': 'EDENRED',
                    'raw_text': str(row.to_dict()),
                    'is_income': amount > 0
                })
            except Exception as e:
                print(f"Error parsing Edenred row: {e}")
        return transactions
