import requests
import os
import json
from dotenv import load_dotenv

load_dotenv()

INDEXA_TOKEN = os.getenv('INDEXA_TOKEN')
HEADERS = {'X-AUTH-TOKEN': INDEXA_TOKEN}
BASE_URL = 'https://api.indexacapital.com'

def test_all_accounts():
    print(f"Token present: {'Yes' if INDEXA_TOKEN else 'No'}")
    res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
    if res.status_code != 200:
        print(f"Error fetching me: {res.status_code}")
        print(res.text)
        return

    accounts = res.json().get('accounts', [])
    print(f"Found {len(accounts)} accounts.")
    for acc in accounts:
        acc_num = acc.get('account_number')
        print(f"\nChecking account: {acc_num} ({acc.get('account_type', 'N/A')})")
        p_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
        if p_res.status_code != 200:
            print(f"  Error fetching performance: {p_res.status_code}")
            continue
        
        data = p_res.json()
        print(f"  Top level keys: {list(data.keys())}")
        ret = data.get('return')
        if ret:
            print(f"  'return' exists. Keys: {list(ret.keys())}")
            fields = ['total_amount', 'investment', 'pl', 'time_return', 'money_return']
            for f in fields:
                print(f"    {f}: {ret.get(f)}")
        else:
            print("  !!!! 'return' IS MISSING OR NONE !!!!")
            # Try to find these fields anywhere else
            import json
            found = []
            def find_anywhere(obj, key):
                if isinstance(obj, dict):
                    if key in obj: found.append(obj[key])
                    for v in obj.values(): find_anywhere(v, key)
                elif isinstance(obj, list):
                    for x in obj: find_anywhere(x, key)
            
            for f in fields:
                found = []
                find_anywhere(data, f)
                if found:
                    print(f"    Found {f} elsewhere: {found[0]} (count: {len(found)})")

test_all_accounts()
