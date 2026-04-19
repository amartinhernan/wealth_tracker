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
    """Obtiene los datos agregados de Indexa Capital sin persistir en la DB."""
    if not INDEXA_TOKEN:
        print("DEBUG: Indexa token is missing in environment")
        return {"status": "error", "message": "Token no configurado en .env"}

    try:
        print(f"DEBUG: Fetching Indexa accounts...")
        user_res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
        if user_res.status_code != 200:
            print(f"DEBUG: Indexa /users/me error: {user_res.status_code}")
            return {"status": "error", "message": f"Error API Indexa: {user_res.status_code}"}

        cuentas = user_res.json().get('accounts', [])
        print(f"DEBUG: Found {len(cuentas)} accounts")
        
        total_actual = 0.0
        total_invested = 0.0
        total_profit = 0.0
        main_twr = 0.0
        main_mwr = 0.0
        max_amount = 0.0
        processed_count = 0

        for acc in cuentas:
            acc_num = acc.get('account_number')
            if not acc_num: continue
            
            print(f"DEBUG: Fetching performance for {acc_num}...")
            perf_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
            if perf_res.status_code != 200:
                print(f"DEBUG: Performance error for {acc_num}: {perf_res.status_code}")
                continue
            
            perf_data = perf_res.json()
            # Attempt to get 'return' summary object
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
                print(f"DEBUG: Account {acc_num} data extracted from 'return' summary")
            else:
                # Fallback: Try to get data from history or portfolios if available
                print(f"DEBUG: 'return' key missing for {acc_num}, trying fallback...")
                history = perf_data.get('history', {})
                # 'history' often has lists like 'total_amount', 'investment'
                if history and isinstance(history, dict) and 'total_amount' in history:
                    h_amt = history.get('total_amount', [])
                    h_inv = history.get('investment', [])
                    if h_amt and len(h_amt) > 0:
                        amt = float(h_amt[-1] or 0.0)
                    if h_inv and len(h_inv) > 0:
                        inv = float(h_inv[-1] or 0.0)
                    prof = amt - inv
                    print(f"DEBUG: Account {acc_num} data extracted from 'history' fallback")
                
                # Check performance lists for returns
                perf_list = perf_data.get('performance', {})
                if 'time_return' in perf_list:
                    h_twr = perf_list.get('time_return', [])
                    if h_twr and len(h_twr) > 0:
                        twr = float(h_twr[-1] or 0.0) * 100

            total_actual += amt
            total_invested += inv
            total_profit += prof
            processed_count += 1

            # Select TWR/MWR from the largest account as representative
            if amt > max_amount:
                max_amount = amt
                main_twr = twr
                main_mwr = mwr

        if processed_count == 0:
            print("DEBUG: No accounts were successfully processed")
            return {"status": "error", "message": "No se pudieron obtener datos de ninguna cuenta"}

        print(f"DEBUG: Sync complete. Total actual: {total_actual}")
        return {
            "status": "success",
            "data": {
                "actual_money": total_actual,
                "total_invested": total_invested,
                "profit_loss": total_profit,
                "twr": main_twr,
                "mwr": main_mwr
            }
        }
    except Exception as e:
        import traceback
        print(f"DEBUG: Indexa Service Exception: {str(e)}")
        print(traceback.format_exc())
        return {"status": "error", "message": f"Excepción en servicio Indexa: {str(e)}"}
