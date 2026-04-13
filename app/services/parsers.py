import pandas as pd
import io
import re
from datetime import datetime

class BankParser:
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
        # Saltar 7 filas
        df = pd.read_excel(io.BytesIO(file_content), skiprows=7)
        transactions = []
        for _, row in df.iterrows():
            try:
                desc = row['CONCEPTO']
                if pd.isna(desc): continue
                
                # Importe puede venir con coma
                amount_raw = row['IMPORTE EUR']
                if isinstance(amount_raw, str):
                    amount = float(amount_raw.replace('.', '').replace(',', '.'))
                else:
                    amount = float(amount_raw)
                
                date_raw = row['FECHA OPERACIÓN']
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
                import traceback
                print(f"Error parsing Santander row: {e}")
                print(traceback.format_exc())
        return transactions

    @staticmethod
    def parse_edenred(file_content):
        # Edenred: Fecha, Detalle movimiento, Importe
        # Saltar 8 filas
        df = pd.read_excel(io.BytesIO(file_content), skiprows=8)
        transactions = []
        for _, row in df.iterrows():
            try:
                desc = row['Detalle movimiento']
                if pd.isna(desc): continue
                
                amount_raw = row['Importe']
                if isinstance(amount_raw, str):
                    amount = float(amount_raw.replace('.', '').replace(',', '.'))
                else:
                    amount = float(amount_raw)
                
                date_raw = row['Fecha']
                if isinstance(date_raw, str):
                    date_obj = datetime.strptime(date_raw, '%Y-%m-%d %H:%M:%S')
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
                import traceback
                print(f"Error parsing Edenred row: {e}")
                print(traceback.format_exc())
        return transactions
