import firebase_admin
from firebase_admin import credentials, firestore
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, 'wealthtracker-d2a0d-firebase-adminsdk-fbsvc-d539bd7a1f.json')

def verify_data(uid):
    if not firebase_admin._apps:
        cred = credentials.Certificate(JSON_PATH)
        firebase_admin.initialize_app(cred)
    
    db = firestore.client()
    user_ref = db.collection('users').document(uid)
    
    collections = ['assets', 'transactions', 'asset_configs', 'categories', 'subcategories']
    
    print(f"--- Verificando datos para UID: {uid} ---")
    for col_name in collections:
        docs = user_ref.collection(col_name).limit(5).get()
        print(f"Colección '{col_name}': {len(docs)} documentos encontrados.")
        for doc in docs:
            print(f"  - Documento ID: {doc.id}")

if __name__ == "__main__":
    verify_data('CfYZBiQ9qLMaHxvLdn0lgOnC17y1')
