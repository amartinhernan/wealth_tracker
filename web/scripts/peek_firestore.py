import firebase_admin
from firebase_admin import credentials, firestore
import json
import os

# Credenciales
cred_path = 'wealthtracker-d2a0d-firebase-adminsdk-fbsvc-d539bd7a1f.json'
if not firebase_admin._apps:
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)

db = firestore.client()
uid = 'CfYZBiQ9qLMaHxvLdn0lgOnC17y1'

tx_ref = db.collection('users').document(uid).collection('transactions')
docs = tx_ref.limit(5).get()

print("--- FIRESTORE SAMPLE TRANSACTIONS ---")
for doc in docs:
    d = doc.to_dict()
    print(f"ID: {doc.id}")
    print(f"Date: {d.get('date')} (Type: {type(d.get('date'))})")
    print(f"Desc: {d.get('description')}")
    print(f"Amt: {d.get('amount')}")
    print(f"Cat: {d.get('category_name')} / {d.get('subcategory_name')}")
    print(f"Raw: {d.get('raw_text')}")
    print("-" * 20)
