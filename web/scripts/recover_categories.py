import sqlite3
import firebase_admin
from firebase_admin import credentials, firestore
import os

# CONFIGURACIÓN
db_sqlite_path = 'instance/patrimonio.db'
cred_path = 'wealthtracker-d2a0d-firebase-adminsdk-fbsvc-d539bd7a1f.json'
uid = 'CfYZBiQ9qLMaHxvLdn0lgOnC17y1'

def recover():
    # 1. Conectar a SQLite y obtener categorías
    if not os.path.exists(db_sqlite_path):
        print("Error: No se encuentra la DB SQLite.")
        return

    conn = sqlite3.connect(db_sqlite_path)
    cursor = conn.cursor()
    
    print("--- LEYENDO DATOS DE SQLITE ---")
    query = """
        SELECT t.id, c.name, s.name, c.id, s.id
        FROM 'transaction' t
        LEFT JOIN category c ON t.category_id = c.id
        LEFT JOIN subcategory s ON t.subcategory_id = s.id
    """
    cursor.execute(query)
    sqlite_data = {str(row[0]): {
        'category_name': row[1],
        'subcategory_name': row[2],
        'category_id': row[3],
        'subcategory_id': row[4]
    } for row in cursor.fetchall()}
    conn.close()
    print(f"Encontradas {len(sqlite_data)} transacciones en SQLite.")

    # 2. Conectar a Firestore
    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    db = firestore.client()

    # 3. Actualizar Firestore
    print("\n--- ACTUALIZANDO FIRESTORE ---")
    tx_ref = db.collection('users').document(uid).collection('transactions')
    docs = tx_ref.stream()

    count = 0
    for doc in docs:
        doc_id = doc.id
        if doc_id in sqlite_data:
            data = sqlite_data[doc_id]
            # Solo actualizar si el nombre no existe o es None
            # O forzar actualización para limpiar "Otros"
            update_fields = {
                'category_name': data['category_name'] or 'Otros',
                'category': data['category_name'] or 'Otros',
                'subcategory_name': data['subcategory_name'] or 'Otros',
                'subcategory': data['subcategory_name'] or 'Otros',
                'category_id': data['category_id'],
                'subcategory_id': data['subcategory_id'],
                'is_reviewed': True
            }
            tx_ref.document(doc_id).update(update_fields)
            print(f"Restaurado ID {doc_id}: {update_fields['category_name']} > {update_fields['subcategory_name']}")
            count += 1

    print(f"\n[OK] Se han recuperado {count} categorías de transacciones.")

if __name__ == "__main__":
    recover()
