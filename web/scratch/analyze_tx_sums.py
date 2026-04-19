import os
import sys
from datetime import datetime, timedelta

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def analyze_transactions(uid):
    tx_ref = get_user_subcollection(uid, 'transactions')
    docs = tx_ref.get()
    
    sums = {}
    counts = {}
    for d in docs:
        t = d.to_dict()
        src = t.get('source', 'Otros')
        amt = t.get('amount', 0)
        sums[src] = sums.get(src, 0) + amt
        counts[src] = counts.get(src, 0) + 1
        
    print("--- Resumen de Transacciones por Fuente ---")
    for src in sorted(sums.keys()):
        print(f"Fuente: {src}")
        print(f"  Total Suma: {sums[src]:,.2f}€")
        print(f"  Nº Transacciones: {counts[src]}")
        print("-" * 20)

    # Revisar si hay activos duplicados en la colección 'assets' para HOY
    assets_ref = get_user_subcollection(uid, 'assets')
    hoy = datetime.now().strftime('%Y-%m-%d')
    docs_hoy = assets_ref.where('date', '==', hoy).get()
    
    print(f"\n--- Activos Guardados Hoy ({hoy}) ---")
    total = 0
    for d in docs_hoy:
        a = d.to_dict()
        val = a.get('actual_money', 0)
        total += val
        print(f"[{d.id}] {a['asset_name']}: {val:,.2f}€")
    print(f"TOTAL: {total:,.2f}€")

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    analyze_transactions(uid)
