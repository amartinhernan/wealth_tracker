import os
import sys
from datetime import date

# Añadir el directorio raíz al path para importar la app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app, db
from app.models import Transaction, Category, Subcategory

def maintenance():
    app = create_app()
    with app.app_context():
        print("--- Iniciando mantenimiento de base de datos ---")

        # 1. Limpieza de datos anteriores al 1 de marzo de 2026
        target_date = date(2026, 3, 1)
        deleted_count = Transaction.query.filter(Transaction.date < target_date).delete()
        print(f"1. Eliminadas {deleted_count} transacciones anteriores al {target_date}.")

        # 2. Corregir signos de Edenred
        # Gastos deben ser negativos. Recargas deben ser positivas.
        # Por defecto los importamos como vienen. Santander suele traer gastos en negativo, Revolut también.
        # Edenred a veces viene con valor absoluto.
        edenred_txs = Transaction.query.filter_by(source='EDENRED').all()
        fixed_signs = 0
        for tx in edenred_txs:
            # Si contiene 'RECARGA', forzamos positivo
            if 'RECARGA' in tx.description.upper():
                if tx.amount < 0:
                    tx.amount = abs(tx.amount)
                    fixed_signs += 1
            else:
                # Es un gasto, forzamos negativo
                if tx.amount > 0:
                    tx.amount = -abs(tx.amount)
                    fixed_signs += 1
        print(f"2. Corregidos {fixed_signs} signos en transacciones de Edenred.")

        # 3. Seed de Categorías (Limpio y con acentos corregidos)
        print("3. Actualizando catálogo de categorías...")
        
        # Mapa de categorías y sus subcategorías
        CAT_DATA = {
            "Alimentación": ["Supermercado", "Restaurantes", "Cafetería", "Delivery"],
            "Vivienda": ["Alquiler/Hipoteca", "Luz", "Agua", "Internet", "Mantenimiento", "Seguros Casa"],
            "Ocio": ["Cine", "Viajes", "Copas/Fiesta", "Eventos", "Cultura"],
            "Transporte": ["Uber/Cabify", "Gasolina", "Parking", "Transporte Público"],
            "Salud": ["Farmacia", "Médico", "Dentista", "Seguro Salud"],
            "Suscripciones": ["Streaming (Netflix/Spotify)", "Cloud (iCloud/Google)", "Gimnasio", "Software"],
            "Movimientos": ["Transferencia Interna", "Aportación Inversión", "Ahorro"],
            "Inversión": ["Compra Activos", "Comisiones Inversión", "Venta Activos"],
            "Ingresos": ["Nómina", "Dividendos", "Bizum Recibido", "Ventas 2ª mano", "Otros Ingresos"],
            "Otros": ["Sin clasificar", "Comisiones Bancarias", "Impuestos", "Regalos"]
        }

        # Borrar categorías antiguas para evitar duplicados o basura
        # Nota: En producción esto debería ser con cuidado, aquí empezamos de cero tras limpiar
        # Subcategory.query.delete()
        # Category.query.delete()

        for cat_name, subcats in CAT_DATA.items():
            cat = Category.query.filter_by(name=cat_name).first()
            if not cat:
                # Intentar buscar versiones mal escritas (ej. Alimentacin)
                short_name = cat_name[:10]
                cat = Category.query.filter(Category.name.like(f"{short_name}%")).first()
                if cat:
                    cat.name = cat_name # Corregir nombre
                else:
                    cat = Category(name=cat_name)
                    db.session.add(cat)
                    db.session.flush()

            for sub_name in subcats:
                sub = Subcategory.query.filter_by(name=sub_name, category_id=cat.id).first()
                if not sub:
                    sub = Subcategory(name=sub_name, category_id=cat.id)
                    db.session.add(sub)
        
        db.session.commit()
        print("3. Catálogo de categorías actualizado.")

        # 4. Detección automática de "Movimientos" (Transferencias)
        print("4. Detectando transferencias internas...")
        transfer_keywords = [
            'SANTANDER', 'REVOLUT', 'INDEXA', 'BINANCE', 'KRAKEN', 'DEGIRO', 
            'TRASP', 'TRANSFER', 'INTERNO', 'BITPANDA', 'DEPOS', 'WITHD'
        ]
        
        mov_cat = Category.query.filter_by(name='Movimientos').first()
        sub_interno = Subcategory.query.filter_by(name='Transferencia Interna', category_id=mov_cat.id).first()
        
        all_txs = Transaction.query.filter(Transaction.date >= target_date).all()
        detected_movs = 0
        for tx in all_txs:
            desc = tx.description.upper()
            if any(k in desc for k in transfer_keywords):
                tx.category_id = mov_cat.id
                tx.subcategory_id = sub_interno.id
                detected_movs += 1
        
        db.session.commit()
        print(f"4. Detectadas {detected_movs} transferencias internas.")

        print("--- Mantenimiento completado con éxito ---")

if __name__ == "__main__":
    maintenance()
