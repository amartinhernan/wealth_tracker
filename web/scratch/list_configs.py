import os
import sys

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def list_configs(uid):
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    docs = configs_ref.get()
    
    print(f"--- Asset Configs for UID: {uid} ---")
    for d in docs:
        c = d.to_dict()
        print(f"ID: {d.id}")
        print(f"  Name: {c.get('name')}")
        print(f"  Holdings: {c.get('holdings')}")
        print(f"  Type: {c.get('type')}")
        print(f"  Ticker: {c.get('ticker')}")
        print("-" * 20)

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    list_configs(uid)
