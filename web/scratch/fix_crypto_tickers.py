from app import create_app
from app.models import db, Asset, AssetConfig
from datetime import datetime

app = create_app()

def fix_crypto():
    with app.app_context():
        # 1. Definir mapeos correctos para CoinGecko
        mappings = {
            "Cardano": "cardano",
            "Shiba Inu": "shiba-inu",
            "POL (ex-MATIC)": "polygon-ecosystem-token",
            "Fantom": "fantom",
            "BITCOIN": "BTC-EUR" # Yahoo es mejor para BTC
        }
        
        print("INFO: Iniciando corrección de activos gestionados...")
        
        configs = AssetConfig.query.all()
        for conf in configs:
            # Actualizar Ticker si es una de las fallidas
            if conf.name in mappings:
                print(f"  - Actualizando ticker de {conf.name}: {conf.ticker} -> {mappings[conf.name]}")
                conf.ticker = mappings[conf.name]
            
            # Sincronizar holdings e invested_total con el último registro de Asset
            last_entry = Asset.query.filter_by(asset_name=conf.name).order_by(Asset.date.desc()).first()
            if last_entry:
                if conf.holdings == 0 and last_entry.actual_holdings > 0:
                    print(f"  - Restaurando holdings para {conf.name}: {last_entry.actual_holdings}")
                    conf.holdings = last_entry.actual_holdings
                
                if conf.invested_total == 0 and last_entry.total_invest_money > 0:
                    print(f"  - Restaurando inversión total para {conf.name}: {last_entry.total_invest_money}")
                    conf.invested_total = last_entry.total_invest_money
        
        db.session.commit()
        print("OK: Corrección finalizada.")

if __name__ == '__main__':
    fix_crypto()
