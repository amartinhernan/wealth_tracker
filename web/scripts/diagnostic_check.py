import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys

# Definir la ruta del JSON
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, 'wealthtracker-d2a0d-firebase-adminsdk-fbsvc-d539bd7a1f.json')

def check(uid):
    if not firebase_admin._apps:
        cred = credentials.Certificate(JSON_PATH)
        firebase_admin.initialize_app(cred)
    
    db_fs = firestore.client()
    user_ref = db_fs.collection('users').document(uid)
    
    print(f"\n--- DIAGNÓSTICO DE DATOS PARA UID: {uid} ---")
    
    collections = ['categories', 'subcategories', 'asset_configs', 'assets', 'transactions']
    
    all_empty = True
    for col in collections:
        docs = list(user_ref.collection(col).limit(5).get())
        count = len(list(user_ref.collection(col).get())) # Esto puede ser lento si hay miles, pero para diagnóstico sirve
        print(f"[{col}]: {count} documentos encontrados.")
        if count > 0:
            all_empty = False
            # Mostrar ejemplo
            first = docs[0].to_dict()
            print(f"   -> Ejemplo: {str(first)[:100]}...")

    if all_empty:
        print("\n[!] AVISO: Todas las colecciones están VACÍAS para este UID.")
        print("Esto sugiere que la migración se hizo para un UID diferente o falló.")
    else:
        print("\n[OK] Se han encontrado datos en Firestore.")
        print("Si no los ves en el Dashboard, asegúrate de que el UID coincide con el que aparece en el pie de página de la web.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python scripts/diagnostic_check.py <FIREBASE_UID>")
        sys.exit(1)
    
    check(sys.argv[1])
