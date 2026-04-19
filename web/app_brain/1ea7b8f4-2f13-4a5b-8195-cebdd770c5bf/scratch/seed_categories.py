import os
import sys

# Add the project root to sys.path
sys.path.append(os.getcwd())

from app import create_app
from app.models import db, Category, Subcategory

def seed():
    app = create_app()
    with app.app_context():
        data = {
            "Transporte": ["Transporte Público", "Peajes", "Combustible", "Mantenimiento Coche", "Uber", "Parking"],
            "Viajes": ["Transporte", "Alojamiento", "Comida", "Ocio", "Otros", "Turismo"],
            "Entretenimiento": ["Tomar Algo", "Plataformas digitales", "Otros", "Compras Caprichos", "Comer fuera", "Cine", "Discoteca"],
            "Bienestar": ["Ropa", "Psicologo", "Peluquería", "Higiene/Belleza", "Dentista", "Farmacia", "Libros", "Lentillas", "Formación"],
            "Otros": ["Regalos", "Otros"],
            "Deporte": ["Gimnasio", "Padel", "Alimentación Deportiva", "Otros", "Crossfit", "Gympass"],
            "Casa": ["Alimentación", "Luz", "Agua", "Gas", "Alquiler", "Seguros", "Internet"]
        }
        
        colors = {
            "Transporte": "#6B7280",
            "Viajes": "#F59E0B",
            "Entretenimiento": "#EC4899",
            "Bienestar": "#10B981",
            "Otros": "#9CA3AF",
            "Deporte": "#EF4444",
            "Casa": "#3B82F6"
        }

        for cat_name, subcats in data.items():
            cat = Category(name=cat_name, color=colors.get(cat_name, "#3B82F6"))
            db.session.add(cat)
            db.session.flush() # To get cat.id
            
            for sub_name in subcats:
                sub = Subcategory(name=sub_name, category_id=cat.id)
                db.session.add(sub)
        
        db.session.commit()
        print("¡Categorías inicializadas con éxito!")

if __name__ == "__main__":
    seed()
