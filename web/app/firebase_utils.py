import firebase_admin
from firebase_admin import credentials, auth, firestore
import functools
from flask import request, jsonify
import os

# Ruta al JSON del Service Account
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'wealthtracker-d2a0d-firebase-adminsdk-fbsvc-d539bd7a1f.json')

# Inicializar Firebase Admin SDK (Singleton pattern)
if not firebase_admin._apps:
    if os.path.exists(SERVICE_ACCOUNT_PATH):
        print("DEBUG: Inicializando Firebase con Service Account local.")
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
    else:
        print("DEBUG: Inicializando Firebase con Application Default Credentials (Cloud Run).")
        firebase_admin.initialize_app()

db_fs = firestore.client()

def token_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        id_token = None
        
        # El token vendrá en el header 'Authorization: Bearer <token>'
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                id_token = auth_header.split(' ')[1]
        
        if not id_token:
            return jsonify({'message': 'Token is missing!'}), 401
        
        try:
            # Verificar el token con Firebase Auth
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']
            print(f"DEBUG: Token verificado. UID extraído: {uid}")
            # Pasar el uid al endpoint como argumento
            return f(uid, *args, **kwargs)
        except Exception as e:
            print(f"DEBUG: Error verificando token: {str(e)}")
            return jsonify({'message': 'Token is invalid!', 'error': str(e)}), 401
            
    return decorated

def get_user_ref(uid):
    """Retorna la referencia al documento raíz del usuario en Firestore."""
    return db_fs.collection('users').document(uid)

def get_user_subcollection(uid, collection_name):
    """Retorna una referencia a una subcolección específica del usuario."""
    return get_user_ref(uid).collection(collection_name)

def firestore_to_dict(data):
    """
    Convierte recursivamente objetos datetime de un dict/lista de Firestore a strings ISO.
    """
    from datetime import datetime
    if isinstance(data, list):
        return [firestore_to_dict(i) for i in data]
    if isinstance(data, dict):
        return {k: firestore_to_dict(v) for k, v in data.items()}
    if isinstance(data, datetime):
        return data.isoformat()
    return data
