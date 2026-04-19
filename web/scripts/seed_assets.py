from app import create_app
from app.models import db, Asset, AssetConfig

app = create_app()

def seed():
    with app.app_context():
        # Obtener nombres y carteras únicas de los activos ya registrados
        unique_assets = Asset.query.with_entities(Asset.asset_name, Asset.portfolio).distinct().all()
        
        count = 0
        for name, portfolio in unique_assets:
            # Verificar si ya existe en la configuración
            if AssetConfig.query.filter_by(name=name).first():
                print(f"⏩ {name} ya está en la configuración.")
                continue
                
            # Buscar el registro más reciente para obtener holdings e inversión actual
            latest = Asset.query.filter_by(asset_name=name).order_by(Asset.date.desc()).first()
            
            new_conf = AssetConfig(
                name=name,
                portfolio=portfolio,
                type='manual', # Por defecto manual para que el usuario elija el ticker después
                holdings=latest.actual_holdings if latest else 0.0,
                invested_total=latest.total_invest_money if latest else 0.0,
                ticker=''
            )
            
            db.session.add(new_conf)
            count += 1
            print(f"Added: {name} ({portfolio}) - {new_conf.holdings} units")
        
        db.session.commit()
        print(f"\nProcess finished. Added {count} assets to the Manager.")

if __name__ == "__main__":
    seed()
