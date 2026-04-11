import pandas as pd
from app import create_app
from app.models import db, Asset
import math

app = create_app()


def load_csv_to_db(csv_path):
    print("Leyendo el archivo CSV...")
    try:
        df = pd.read_csv(csv_path, sep=',', skiprows=1, on_bad_lines='skip')
        if 'DATE' not in df.columns: raise ValueError()
    except:
        try: df = pd.read_csv(csv_path, sep=';', on_bad_lines='skip', decimal=',')
        except Exception as e: return print(f"❌ Error al leer el archivo: {e}")
            
    df.columns = df.columns.str.strip()
    if 'DATE' not in df.columns: return print("❌ ERROR: No encuentro la columna 'DATE'.")
        
    # Crear un diccionario inteligente leyendo tu historial para saber qué activo va en qué cartera
    asset_to_port = {}
    for _, r in df.iterrows():
        a = str(r.get('ASSETS', '')).strip()
        p = str(r.get('PORTFOLIO', '')).strip()
        if p and p.upper() != 'NAN':
            asset_to_port[a] = p
            
    with app.app_context():
        db.create_all()
        db.session.query(Asset).delete() 
        
        for index, row in df.iterrows():
            date_val = str(row['DATE']).strip()
            if pd.isna(row['DATE']) or date_val == "" or date_val.upper() == "TOTAL" or date_val.upper() == "NAN": 
                continue
            
            try:
                parsed_date = pd.to_datetime(date_val, dayfirst=True)
                formatted_date = parsed_date.strftime('%Y-%m-%d')
            except: continue
                
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
            
            # --- MAGIA: Auto-completado de Carteras ---
            if not port or port.upper() == 'NAN':
                if asset_name in asset_to_port:
                    port = asset_to_port[asset_name] # Si ya existía, copia su cartera
                else:
                    # Si es nuevo, lee el nombre para adivinarlo
                    up_name = asset_name.upper()
                    if any(x in up_name for x in ['SANTANDER', 'REVOLUT', 'DEGIRO', 'WALLET', 'BINANCE']):
                        port = 'CASH'
                    elif 'INDEXA' in up_name: port = 'FUNDS'
                    elif 'ETF' in up_name or 'VANGUARD' in up_name: port = 'ETFS'
                    elif any(x in up_name for x in ['BITCOIN', 'CRYPTO', 'CARDANO', 'SHIBA', 'POLYGON', 'FANTOM']): port = 'CRYPTO'
                    else: port = 'OTROS'

            try:
                new_asset = Asset(
                    date=formatted_date,
                    asset_name=asset_name,
                    portfolio=port.upper(), # Guardamos todo en mayúsculas para unificar
                    actual_price=to_float(row.get('ACTUAL PRICE (€)', 0)),
                    avg_buy_price=to_float(row.get('AVG. BUY PRICE', 0)),
                    actual_holdings=to_float(row.get('ACTUAL HOLDINGS', 0)),
                    total_invest_money=to_float(row.get('TOTAL INVEST MONEY', 0)),
                    actual_money=to_float(row.get('ACTUAL MONEY', 0)),
                    profit_loss=to_float(row.get('PROFIT/LOSS', 0)),
                    profit_loss_pct=to_float(row.get('PROFIT/LOSS (%)', 0))
                )
                db.session.add(new_asset)
            except: pass 
        
        db.session.commit()
        print("Cargada base de datos y carteras auto-asignadas!")

if __name__ == '__main__':
    load_csv_to_db('BBDD_ASSETS.csv')