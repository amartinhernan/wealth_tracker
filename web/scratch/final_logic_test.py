import requests
import os
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

INDEXA_TOKEN = os.getenv('INDEXA_TOKEN')
HEADERS = {'X-AUTH-TOKEN': INDEXA_TOKEN}
BASE_URL = 'https://api.indexacapital.com'

def fetch_indexa_data_TEST():
    """Version of the function to test fallback logic and robustness."""
    if not INDEXA_TOKEN:
        print("DEBUG: Indexa token is missing")
        return None

    try:
        user_res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
        if user_res.status_code != 200:
            print(f"DEBUG: Indexa /users/me error: {user_res.status_code}")
            return None

        cuentas = user_res.json().get('accounts', [])
        print(f"DEBUG: Found {len(cuentas)} accounts")
        
        total_actual = 0.0
        total_invested = 0.0
        total_profit = 0.0
        main_twr = 0.0
        main_mwr = 0.0
        max_amount = 0.0

        for acc in cuentas:
            acc_num = acc.get('account_number')
            if not acc_num: continue
            
            p_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
            if p_res.status_code != 200: continue
            
            perf_data = p_res.json()
            ret = perf_data.get('return')
            
            amt, inv, prof, twr, mwr = 0.0, 0.0, 0.0, 0.0, 0.0
            
            if ret and isinstance(ret, dict):
                amt = float(ret.get('total_amount') or 0.0)
                inv = float(ret.get('investment') or ret.get('inflows') or 0.0)
                prof = float(ret.get('pl') or (amt - inv))
                twr = float(ret.get('time_return') or 0.0) * 100
                mwr = float(ret.get('money_return') or 0.0) * 100
                print(f"DEBUG: {acc_num} -> return summary found")
            else:
                print(f"DEBUG: {acc_num} -> using fallback")
                history = perf_data.get('history', {})
                if history and isinstance(history, dict) and 'total_amount' in history:
                    h_amt = history.get('total_amount', [])
                    h_inv = history.get('investment', [])
                    if h_amt: amt = float(h_amt[-1] or 0.0)
                    if h_inv: inv = float(h_inv[-1] or 0.0)
                    prof = amt - inv
                
                perf_list = perf_data.get('performance', {})
                if 'time_return' in perf_list:
                    h_twr = perf_list.get('time_return', [])
                    if h_twr: twr = float(h_twr[-1] or 0.0) * 100

            total_actual += amt
            total_invested += inv
            total_profit += prof

            if amt > max_amount:
                max_amount = amt
                main_twr = twr
                main_mwr = mwr

        return {
            "actual_money": total_actual,
            "total_invested": total_invested,
            "profit_loss": total_profit,
            "twr": main_twr,
            "mwr": main_mwr
        }
    except Exception as e:
        print(f"DEBUG: Exception: {e}")
        return None

print(json.dumps(fetch_indexa_data_TEST(), indent=2))
