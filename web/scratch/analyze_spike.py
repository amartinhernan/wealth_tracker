import os
import sys
from datetime import datetime, timedelta

# Añadir el path del proyecto para importar app
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

def analyze_spike(uid):
    assets_ref = get_user_subcollection(uid, 'assets')
    
    # Obtener documentos de hoy y de hace 2-3 días
    hoy = datetime.now().strftime('%Y-%m-%d')
    ayer = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    anteayer = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
    
    docs_hoy = assets_ref.where('date', '==', hoy).get()
    docs_ante = assets_ref.where('date', '==', anteayer).get()
    
    data_hoy = {d.to_dict()['asset_name']: d.to_dict() for d in docs_hoy}
    data_ante = {d.to_dict()['asset_name']: d.to_dict() for d in docs_ante}
    
    print(f"--- Análisis de Patrimonio ({anteayer} vs {hoy}) ---")
    total_hoy = 0
    total_ante = 0
    
    all_names = set(list(data_hoy.keys()) + list(data_ante.keys()))
    
    for name in sorted(all_names):
        val_hoy = data_hoy.get(name, {}).get('actual_money', 0)
        val_ante = data_ante.get(name, {}).get('actual_money', 0)
        diff = val_hoy - val_ante
        total_hoy += val_hoy
        total_ante += val_ante
        
        if abs(diff) > 100:
            print(f"Activo: {name}")
            print(f"  {anteayer}: {val_ante:,.2f}€")
            print(f"  {hoy}: {val_hoy:,.2f}€")
            print(f"  Diferencia: {diff:,.2f}€")
            
    print(f"\nTOTAL ({anteayer}): {total_ante:,.2f}€")
    print(f"TOTAL ({hoy}): {total_hoy:,.2f}€")
    print(f"INCREMENTO TOTAL: {total_hoy - total_ante:,.2f}€")

if __name__ == "__main__":
    # El UID lo saqué de los logs del terminal del usuario
    uid = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"
    analyze_spike(uid)
