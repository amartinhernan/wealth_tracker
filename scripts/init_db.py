import pandas as pd
from app import create_app
from app.models import db, Asset
import math
import os

app = create_app()

def load_csv_to_db(csv_path):
    print(f"INFO: Iniciando carga de inversiones desde: {csv_path}")
    
    if not os.path.exists(csv_path):
        print(f"ERROR: El archivo {csv_path} no existe.")
        return

    # Intentar detectar el separador
    try:
        # Probamos primero con punto y coma (;) que es el que parece tener el archivo
        df = pd.read_csv(csv_path, sep=';', on_bad_lines='skip', decimal=',')
        if 'DATE' not in df.columns:
            # Si no está DATE, probamos con coma (,)
            df = pd.read_csv(csv_path, sep=',', on_bad_lines='skip')
            if 'DATE' not in df.columns:
                raise ValueError("No se encuentra la columna 'DATE' con ningún separador (, o ;)")
    except Exception as e:
        print(f"ERROR: Error crítico leyendo el CSV: {e}")
        return

    df.columns = df.columns.str.strip()
    print(f"INFO: CSV leído correctamente. Filas encontradas: {len(df)}")

    # Crear mapeo de activos a carteras para inteligencia
    asset_to_port = {}
    for _, r in df.iterrows():
        a = str(r.get('ASSETS', '')).strip()
        p = str(r.get('PORTFOLIO', '')).strip()
        if p and p.upper() != 'NAN':
            asset_to_port[a] = p

    with app.app_context():
        try:
            db.create_all()
            
            # SOLO BORRAMOS SI HEMOS LLEGADO AQUÍ Y TENEMOS DATOS
            if len(df) > 0:
                print("INFO: Limpiando tabla Asset para nueva carga...")
                db.session.query(Asset).delete()
            else:
                print("AVISO: El CSV está vacío. No se borrará nada.")
                return

            new_count = 0
            for index, row in df.iterrows():
                date_val = str(row['DATE']).strip()
                if pd.isna(row['DATE']) or date_val == "" or date_val.upper() in ["TOTAL", "NAN"]: 
                    continue
                
                try:
                    parsed_date = pd.to_datetime(date_val, dayfirst=True)
                    formatted_date = parsed_date.strftime('%Y-%m-%d')
                except:
                    print(f"AVISO: Fila {index}: Error en fecha '{date_val}'")
                    continue
                    
                def to_float(val):
                    if pd.isna(val): return 0.0
                    try:
                        if isinstance(val, str):
                            val = val.replace('.', '').replace(',', '.').replace('€', '').replace('%', '').strip()
                        v = float(val)
                        return 0.0 if math.isnan(v) or math.isinf(v) else v
                    except: return 0.0
                
                asset_name = str(row.get('ASSETS', '')).strip()
                port = str(row.get('PORTFOLIO', '')).strip()
                
                if not port or port.upper() == 'NAN':
                    if asset_name in asset_to_port:
                        port = asset_to_port[asset_name]
                    else:
                        up_name = asset_name.upper()
                        if any(x in up_name for x in ['SANTANDER', 'REVOLUT', 'DEGIRO', 'WALLET', 'BINANCE']):
                            port = 'CASH'
                        elif 'INDEXA' in up_name: port = 'FUNDS'
                        elif 'ETF' in up_name or 'VANGUARD' in up_name: port = 'ETFS'
                        elif any(x in up_name for x in ['BITCOIN', 'CRYPTO', 'CARDANO', 'SHIBA', 'POLYGON', 'FANTOM']): port = 'CRYPTO'
                        else: port = 'OTROS'

                new_asset = Asset(
                    date=formatted_date,
                    asset_name=asset_name,
                    portfolio=port.upper(),
                    actual_price=to_float(row.get('ACTUAL PRICE (€)', 0)),
                    avg_buy_price=to_float(row.get('AVG. BUY PRICE', 0)),
                    actual_holdings=to_float(row.get('ACTUAL HOLDINGS', 0)),
                    total_invest_money=to_float(row.get('TOTAL INVEST MONEY', 0)),
                    actual_money=to_float(row.get('ACTUAL MONEY', 0)),
                    profit_loss=to_float(row.get('PROFIT/LOSS', 0)),
                    profit_loss_pct=to_float(row.get('PROFIT/LOSS (%)', 0))
                )
                db.session.add(new_asset)
                new_count += 1
            
            db.session.commit()
            print(f"OK: Se han cargado {new_count} registros de inversión.")
            
            # --- NUEVA LÓGICA: Sincronizar con AssetConfig ---
            from app.models import AssetConfig
            print("INFO: Sincronizando nombres de activos con AssetConfig...")
            unique_assets = df['ASSETS'].unique()
            added_configs = 0
            for a_name in unique_assets:
                a_name = str(a_name).strip()
                if not a_name or a_name.upper() in ["TOTAL", "NAN"]: continue
                
                # Comprobar si ya existe
                existing = AssetConfig.query.filter_by(name=a_name).first()
                if not existing:
                    # Intentar adivinar el tipo
                    up_name = a_name.upper()
                    a_type = 'manual'
                    if 'INDEXA' in up_name: a_type = 'indexa'
                    elif any(x in up_name for x in ['BITCOIN', 'CRYPTO', 'SHIBA']): a_type = 'crypto'
                    
                    # Intentar adivinar cartera si el mapeo existía
                    port = asset_to_port.get(a_name, 'OTROS').upper()
                    
                    new_conf = AssetConfig(
                        name=a_name,
                        portfolio=port,
                        type=a_type,
                        subtype='market'
                    )
                    db.session.add(new_conf)
                    added_configs += 1
            
            db.session.commit()
            print(f"OK: Se han creado {added_configs} nuevas configuraciones de activos.")
            
        except Exception as e:
            db.session.rollback()
            print(f"ERROR: Error durante la carga en BD: {e}")

if __name__ == '__main__':
    load_csv_to_db('BBDD_ASSETS.csv')