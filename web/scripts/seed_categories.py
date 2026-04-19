from app import create_app
from app.models import db, Category, Subcategory

def seed_categories():
    app = create_app()
    with app.app_context():
        # Categorías base
        data = {
            "Vivienda": ["Alquiler", "Hipoteca", "Luz", "Agua", "Gas", "Internet", "Reformas"],
            "Alimentación": ["Supermercado", "Restaurantes", "Delivery", "Cafetería"],
            "Transporte": ["Gasolina", "Parking", "Peajes", "Transporte Público", "Uber/Cabify", "Mantenimiento Coche"],
            "Suscripciones": ["Netflix", "Spotify", "Amazon Prime", "Gimnasio", "Software"],
            "Ocio & Lifestyle": ["Cine", "Viajes", "Ropa", "Deporte", "Regalos"],
            "Salud": ["Farmacia", "Médico", "Seguro Salud"],
            "Finanzas": ["Impuestos", "Comisiones", "Intereses", "Seguros"],
            "Ingresos": ["Nómina", "Dividendos", "Ventas", "Bizum Ingreso"]
        }
        
        colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6B7280", "#22C55E"]
        
        for i, (cat_name, subs) in enumerate(data.items()):
            exists = Category.query.filter_by(name=cat_name).first()
            if not exists:
                cat = Category(name=cat_name, color=colors[i % len(colors)])
                db.session.add(cat)
                db.session.flush()
                
                for s_name in subs:
                    sub = Subcategory(name=s_name, category_id=cat.id)
                    db.session.add(sub)
        
        db.session.commit()
        print("✅ Categorías iniciales creadas con éxito.")

if __name__ == '__main__':
    seed_categories()
