from app import create_app
from app.models import db, AssetConfig

app = create_app()
with app.app_context():
    # create_all intentará crear las tablas que no existen
    db.create_all()
    print("Base de datos actualizada con AssetConfig!")
