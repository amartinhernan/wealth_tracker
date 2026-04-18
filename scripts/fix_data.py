from datetime import datetime
from app import create_app
from app.models import db, AssetConfig, Asset

app = create_app()

def repair():
    with app.app_context():
        hoy = datetime.now().strftime('%Y-%m-%d')
        
        # 1. Corregir Criptos a Auto
        crypto_map = {
            'BITCOIN': 'BTC-EUR',
            'CARDANO': 'ADA-EUR',
            'Shiba Inu EUR': 'SHIB-EUR',
            'SHIBA': 'SHIB-EUR', # Por si aparece
            'POLYGON MATIC': 'MATIC-EUR',
            'FANTOM': 'FTM-EUR'
        }
        
        for name, ticker in crypto_map.items():
            conf = AssetConfig.query.filter_by(name=name).first()
            if conf:
                conf.type = 'auto'
                conf.ticker = ticker
                print(f"Repair Config: {name} -> Auto ({ticker})")

        # 2. Corregir Vanguard
        vanguard = AssetConfig.query.filter(AssetConfig.name.like('%VANGUARD%')).first()
        if vanguard:
            vanguard.ticker = 'VUSD.L'
            vanguard.type = 'auto'
            print(f"Repair Config: Vanguard -> VUSD.L")

        db.session.commit()
        
        # 3. LIMPIEZA DRÁSTICA de la tabla Asset para hoy
        # Borramos los registros de hoy para que el sync los cree de cero y bien
        deleted = Asset.query.filter_by(date=hoy).delete()
        db.session.commit()
        print(f"Cleanup: Borrados {deleted} registros de hoy en la tabla de resultados.")

        print("\nDatabase repair and cleanup finished.")

if __name__ == "__main__":
    repair()
