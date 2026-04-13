import os
import sys

# Add the project root to sys.path
sys.path.append(os.getcwd())

from app import create_app
from app.models import db

def sync_db():
    app = create_app()
    with app.app_context():
        print("Borrando tablas antiguas...")
        db.drop_all()
        print("Sincronizando base de datos...")
        db.create_all()
        print("¡Base de datos sincronizada con éxito!")

if __name__ == "__main__":
    sync_db()
