import os
import sys

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def debug_15th(uid):
    assets_ref = get_user_subcollection(uid, 'assets')
    docs = assets_ref.where('date', '==', '2026-04-15').get()
    
    total = 0
    print(f"{'Asset':<40} | {'Invested':>12}")
    print("-" * 55)
    for d in docs:
        data = d.to_dict()
        name = data.get('asset_name')
        inv = data.get('total_invest_money', 0)
        print(f"{name:<40} | {inv:>12,.2f}")
        total += inv
    print("-" * 55)
    print(f"{'TOTAL SUM':<40} | {total:>12,.2f}")

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    debug_15th(uid)
