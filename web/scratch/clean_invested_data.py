import os
import sys

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def clean_data(uid):
    # 1. Limpiar Configs
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    configs = configs_ref.get()
    
    cash_asset_names = []
    for d in configs:
        data = d.to_dict()
        if data.get('portfolio', '').upper() == 'CASH':
            name = data.get('name')
            print(f"Cleaning config for {name}...")
            d.reference.update({'invested_total': 0.0})
            cash_asset_names.append(name)
    
    # 2. Limpiar Historial (Colección assets) de los últimos 15 días
    assets_ref = get_user_subcollection(uid, 'assets')
    
    # Actualizamos todos los registros de los activos identificados como CASH
    for name in cash_asset_names:
        print(f"Cleaning history for {name}...")
        docs = assets_ref.where('asset_name', '==', name).get()
        for doc in docs:
            # Solo actualizamos si el total_invest_money era mayor que 0
            if doc.to_dict().get('total_invest_money', 0) > 0:
                doc.reference.update({'total_invest_money': 0.0})

if __name__ == "__main__":
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    clean_data(uid)
