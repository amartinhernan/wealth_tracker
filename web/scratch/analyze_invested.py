import os
import sys
from datetime import datetime, timedelta

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def analyze_invested_history(uid):
    assets_ref = get_user_subcollection(uid, 'assets')
    
    # Obtener documentos de los últimos 10 días
    days = []
    for i in range(10):
        d = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        days.append(d)
    
    all_data = {}
    for d in days:
        docs = assets_ref.where('date', '==', d).get()
        all_data[d] = {doc.to_dict()['asset_name']: doc.to_dict() for doc in docs}
    
    print(f"{'Día':<12} | {'Total Invertido':>18} | {'Total Valor':>18}")
    print("-" * 60)
    
    for d in sorted(days):
        day_assets = all_data.get(d, {})
        tot_inv = sum(a.get('total_invest_money', 0) for a in day_assets.values())
        tot_val = sum(a.get('actual_money', 0) for a in day_assets.values())
        print(f"{d:<12} | {tot_inv:>15,.2f}€ | {tot_val:>15,.2f}€")
        
        if tot_inv > 0 or tot_val > 0:
            for name, data in day_assets.items():
                inv = data.get('total_invest_money', 0)
                val = data.get('actual_money', 0)
                if inv > 1000 or val > 1000:
                    print(f"  - {name:<40}: Inv: {inv:>10,.2f}€ | Val: {val:>10,.2f}€")

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    analyze_invested_history(uid)
