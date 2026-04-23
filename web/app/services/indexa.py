import requests
import os
from datetime import datetime
from dotenv import load_dotenv

# Find .env in the parent directory of 'app'
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env_path = os.path.join(base_dir, '.env')
load_dotenv(env_path)

INDEXA_TOKEN = os.getenv('INDEXA_TOKEN')
HEADERS = {'X-AUTH-TOKEN': INDEXA_TOKEN}
BASE_URL = 'https://api.indexacapital.com'

def fetch_indexa_data():
    """
    Obtiene los datos agregados y detallados de Indexa Capital.
    Busca tanto en cuentas de fondos como en planes de pensiones/seguros.
    """
    if not INDEXA_TOKEN:
        print("DEBUG: Indexa token is missing in environment")
        return {"status": "error", "message": "Token no configurado en .env"}

    try:
        print(f"DEBUG: Fetching Indexa user data...")
        user_res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
        if user_res.status_code != 200:
            print(f"DEBUG: Indexa /users/me error: {user_res.status_code}")
            return {"status": "error", "message": f"Error API Indexa: {user_res.status_code}"}

        user_json = user_res.json()
        
        # Discovery of all account-like lists
        accounts = user_json.get('accounts', [])
        insurances = user_json.get('insurances', [])
        pensions = user_json.get('pension_plans', [])
        
        all_cuentas = accounts + insurances + pensions
        print(f"DEBUG: Found {len(all_cuentas)} potential products (accounts={len(accounts)}, insurances={len(insurances)}, pensions={len(pensions)})")
        
        total_actual = 0.0
        total_invested = 0.0
        total_profit = 0.0
        main_twr = 0.0
        main_mwr = 0.0
        max_amount = 0.0
        processed_count = 0
        account_details = {}

        for acc in all_cuentas:
            acc_num = acc.get('account_number')
            if not acc_num: continue
            
            print(f"DEBUG: Fetching performance for {acc_num}...")
            perf_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
            if perf_res.status_code != 200:
                print(f"DEBUG: Performance error for {acc_num}: {perf_res.status_code}")
                continue
            
            perf_data = perf_res.json()
            ret = perf_data.get('return')
            
            amt = 0.0
            inv = 0.0
            prof = 0.0
            twr = 0.0
            mwr = 0.0
            
            if ret and isinstance(ret, dict):
                amt = float(ret.get('total_amount') or 0.0)
                inv = float(ret.get('investment') or ret.get('inflows') or 0.0)
                prof = float(ret.get('pl') or (amt - inv))
                twr = float(ret.get('time_return') or 0.0) * 100
                mwr = float(ret.get('money_return') or 0.0) * 100
            else:
                # Fallback to history
                history = perf_data.get('history', {})
                if history and isinstance(history, dict) and 'total_amount' in history:
                    h_amt = history.get('total_amount', [])
                    h_inv = history.get('investment', [])
                    if h_amt: amt = float(h_amt[-1] or 0.0)
                    if h_inv: inv = float(h_inv[-1] or 0.0)
                    prof = amt - inv
                
                # Try to get TWR from performance list
                perf_list = perf_data.get('performance', {})
                if 'time_return' in perf_list:
                    h_twr = perf_list.get('time_return', [])
                    if h_twr: twr = float(h_twr[-1] or 0.0) * 100

            total_actual += amt
            total_invested += inv
            total_profit += prof
            processed_count += 1
            
            # Save per-account details for granular mapping
            account_details[acc_num] = {
                "actual_money": amt,
                "total_invested": inv,
                "profit_loss": prof,
                "twr": twr,
                "mwr": mwr,
                "risk": acc.get('risk')
            }

            if amt > max_amount:
                max_amount = amt
                main_twr = twr
                main_mwr = mwr

        if processed_count == 0:
            return {"status": "error", "message": "No se pudieron obtener datos de ninguna cuenta"}

        return {
            "status": "success",
            "data": {
                "actual_money": total_actual,
                "total_invested": total_invested,
                "profit_loss": total_profit,
                "twr": main_twr,
                "mwr": main_mwr,
                "accounts": account_details
            }
        }
    except Exception as e:
        import traceback
        print(f"DEBUG: Indexa Service Exception: {str(e)}")
        print(traceback.format_exc())
        return {"status": "error", "message": f"Excepción en servicio Indexa: {str(e)}"}
