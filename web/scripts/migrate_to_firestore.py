import sqlite3
import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys
from datetime import datetime

# Definir la ruta del DB y del JSON
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'instance', 'patrimonio.db')
if not os.path.exists(DB_PATH):
    # Intentar en la raíz si no está en instance
    DB_PATH = os.path.join(BASE_DIR, 'patrimonio.db')

JSON_PATH = os.path.join(BASE_DIR, 'wealthtracker-d2a0d-firebase-adminsdk-fbsvc-d539bd7a1f.json')

def migrate(uid):
    if not firebase_admin._apps:
        cred = credentials.Certificate(JSON_PATH)
        firebase_admin.initialize_app(cred)
    
    db_fs = firestore.client()
    user_ref = db_fs.collection('users').document(uid)
    
    print(f"--- Iniciando migración para el usuario: {uid} ---")
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Migrar CATEGORÍAS
    print("Migrando categorías...")
    cursor.execute("SELECT * FROM category")
    cats = cursor.fetchall()
    cat_mapping = {} # Para mapear IDs de SQLite a Firestore si fuera necesario (aunque usaremos el nombre)
    
    for c in cats:
        data = dict(c)
        cat_id = data.pop('id')
        user_ref.collection('categories').document(str(cat_id)).set(data)
        cat_mapping[cat_id] = data['name']
        
    # 2. Migrar SUBCATEGORÍAS
    print("Migrando subcategorías...")
    cursor.execute("SELECT * FROM subcategory")
    subcats = cursor.fetchall()
    for s in subcats:
        data = dict(s)
        sub_id = data.pop('id')
        user_ref.collection('subcategories').document(str(sub_id)).set(data)

    # 3. Migrar ASSET_CONFIG
    print("Migrando configuraciones de activos...")
    cursor.execute("SELECT * FROM asset_config")
    configs = cursor.fetchall()
    for conf in configs:
        data = dict(conf)
        conf_id = data.pop('id')
        # Convertir updated_at de string a datetime si es necesario
        if data.get('updated_at'):
            try:
                data['updated_at'] = datetime.strptime(data['updated_at'], '%Y-%m-%d %H:%M:%S.%f')
            except:
                pass
        user_ref.collection('asset_configs').document(data['name']).set(data)

    # 4. Migrar TRANSACCIONES
    print("Migrando transacciones...")
    cursor.execute('SELECT * FROM "transaction"')
    txs = cursor.fetchall()
    for t in txs:
        data = dict(t)
        tx_id = data.pop('id')
        if data.get('date'):
            try:
                data['date'] = datetime.strptime(data['date'], '%Y-%m-%d %H:%M:%S.%f')
            except:
                try:
                    data['date'] = datetime.strptime(data['date'], '%Y-%m-%d %H:%M:%S')
                except:
                    pass
        user_ref.collection('transactions').document(str(tx_id)).set(data)

    # 5. Migrar ASSETS (Histórico)
    print("Migrando historial de activos...")
    cursor.execute("SELECT * FROM asset")
    assets = cursor.fetchall()
    for a in assets:
        data = dict(a)
        asset_record_id = data.pop('id')
        # Usamos id compuesto para evitar duplicados en re-ejecuciones
        doc_id = f"{data['date']}_{data['asset_name']}"
        user_ref.collection('assets').document(doc_id).set(data)

    print("--- MIGRACIÓN COMPLETADA CON ÉXITO ---")
    conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python migrate_to_firestore.py <FIREBASE_UID>")
        sys.exit(1)
    
    migrate(sys.argv[1])
