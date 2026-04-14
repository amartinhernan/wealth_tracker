import os
import sys

# Añadir el directorio raíz al path para poder importar la app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app, db
from app.models import Transaction, Category, Subcategory
from app.services.ai_categorizer import AICategorizer

def retrace_uncategorized():
    app = create_app()
    with app.app_context():
        # Buscar transacciones sin categoría
        print("Buscando transacciones sin categoría...")
        txs = Transaction.query.filter(Transaction.category_id == None).all()
        print(f"Encontradas {len(txs)} transacciones para categorizar.")

        if not txs:
            print("No hay nada que categorizar.")
            return

        categorizer = AICategorizer()
        
        # Mapeos para eficiencia
        cat_map = {c.name.lower(): c.id for c in Category.query.all()}
        sub_map = {}
        for c in Category.query.all():
            for s in c.subcategories:
                sub_map[f"{c.id}_{s.name.lower()}"] = s.id

        for t in txs:
            print(f"Categorizando ID {t.id}: {t.description} ({t.amount}€)...")
            cat_name, sub_name = categorizer.categorize(t.description, t.amount)
            
            if cat_name:
                c_id = cat_map.get(cat_name.lower())
                if c_id:
                    t.category_id = c_id
                    s_id = sub_map.get(f"{c_id}_{sub_name.lower()}") if sub_name else None
                    if s_id:
                        t.subcategory_id = s_id
                    print(f"  -> Asignado: {cat_name} / {sub_name}")
                else:
                    print(f"  -> Error: Categoría '{cat_name}' no encontrada en BD.")
            else:
                print("  -> AI no pudo categorizar.")

        db.session.commit()
        print("¡Proceso finalizado!")

if __name__ == "__main__":
    retrace_uncategorized()
