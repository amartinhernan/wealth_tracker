import os
import sys
from datetime import datetime, timedelta

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def analyze_history(uid):
    assets_ref = get_user_subcollection(uid, 'assets')
    
    # Obtener documentos de los últimos 10 días
    days = []
    for i in range(10):
        d = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        days.append(d)
    
    # Consultar por cada día
    all_data = {}
    for d in days:
        docs = assets_ref.where('date', '==', d).get()
        all_data[d] = {doc.to_dict()['asset_name']: doc.to_dict() for doc in docs}
    
    print(f"{'Día':<12} | {'Total Patrimonio':>18} | {'Activos Trackeados'}")
    print("-" * 60)
    
    for d in sorted(days):
        day_assets = all_data.get(d, {})
        total = sum(a.get('actual_money', 0) for a in day_assets.values())
        count = len(day_assets)
        print(f"{d:<12} | {total:>15,.2f}€ | {count} activos")
        
        # Mostrar detalle si el total es > 0
        if total > 0:
            for name, data in day_assets.items():
                val = data.get('actual_money', 0)
                if val > 1000:
                    print(f"  - {name:<40}: {val:>12,.2f}€")

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    analyze_history(uid)
