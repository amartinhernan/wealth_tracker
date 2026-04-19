import os
import sys

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def compare_dates(uid, d1, d2):
    assets_ref = get_user_subcollection(uid, 'assets')
    docs1 = assets_ref.where('date', '==', d1).get()
    docs2 = assets_ref.where('date', '==', d2).get()
    
    data1 = {d.to_dict()['asset_name']: d.to_dict() for d in docs1}
    data2 = {d.to_dict()['asset_name']: d.to_dict() for d in docs2}
    
    all_names = set(list(data1.keys()) + list(data2.keys()))
    
    print(f"{'Activo':<40} | {'Inv ' + d1:>12} | {'Inv ' + d2:>12} | {'Diff':>12}")
    print("-" * 85)
    
    total_diff = 0
    for name in sorted(all_names):
        inv1 = data1.get(name, {}).get('total_invest_money', 0)
        inv2 = data2.get(name, {}).get('total_invest_money', 0)
        diff = inv2 - inv1
        total_diff += diff
        if abs(diff) > 1:
            print(f"{name:<40} | {inv1:>12,.2f} | {inv2:>12,.2f} | {diff:>12,.2f}")
            
    print("-" * 85)
    print(f"{'TOTAL DIFF':<40} | {'':>12} | {'':>12} | {total_diff:>12,.2f}")

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    compare_dates(uid, "2026-04-15", "2026-04-18")
