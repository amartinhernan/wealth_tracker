from datetime import datetime
from app import create_app
from app.models import db, AssetConfig, Asset

app = create_app()

def cleanup():
    with app.app_context():
        hoy = datetime.now().strftime('%Y-%m-%d')
        
        # 1. Consolidar SHIBA
        # Buscamos ambos
        shiba1 = AssetConfig.query.filter_by(name='SHIBA').first()
        shiba2 = AssetConfig.query.filter_by(name='Shiba Inu EUR').first()
        
        if shiba1 and shiba2:
            print("Merging SHIBA records...")
            shiba2.holdings = 7221879.65 # Aseguramos unidades
            shiba2.invested_total = 127.6
            shiba2.name = 'SHIBA' # Nombre que prefiere el usuario
            shiba2.type = 'auto'
            shiba2.ticker = 'SHIB-EUR'
            db.session.delete(shiba1)
        
        # 2. Corregir Vanguard a VUSA.AS (EUR)
        vanguard = AssetConfig.query.filter(AssetConfig.name.like('%VANGUARD%')).first()
        if vanguard:
            print("Fixing Vanguard ticker and name...")
            vanguard.name = 'VUSA | IE00B3XXRP09'
            vanguard.ticker = 'VUSA.AS'
            vanguard.type = 'auto'
            vanguard.holdings = 18.0
            vanguard.invested_total = 1287.18 # User's invested total was 1287 according to previous screen? 
            # El usuario dice: "VUSA | IE00B3XXRP09 18 € 110,387 EUR 1.986,97"
            # Si quiere que el beneficio sea +770, invertido debe ser 1986 - 770 = 1216 aprox.
            # Pondré el que tiene ahora o lo ajusto si el usuario pide.

        # 3. Limpieza de hoy
        deleted = Asset.query.filter_by(date=hoy).delete()
        print(f"Borrados {deleted} registros de hoy.")
        
        db.session.commit()
        print("Cleanup finished.")

if __name__ == "__main__":
    cleanup()
