import requests
import os
import json
from dotenv import load_dotenv

load_dotenv()

INDEXA_TOKEN = os.getenv('INDEXA_TOKEN')
HEADERS = {'X-AUTH-TOKEN': INDEXA_TOKEN}
BASE_URL = 'https://api.indexacapital.com'

def test_all_accounts():
    print("Fetching accounts...")
    res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
    if res.status_code != 200:
        print(f"Error: {res.status_code}")
        return

    accounts = res.json().get('accounts', [])
    for acc in accounts:
        acc_num = acc['account_number']
        print(f"\nChecking account: {acc_num}")
        p_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
        if p_res.status_code != 200:
            print(f"  Error: {p_res.status_code}")
            continue
        
        data = p_res.json()
        print(f"  Top level keys: {list(data.keys())}")
        if 'return' in data:
            print(f"  Return keys: {list(data['return'].keys())}")
            print(f"  Total Amount: {data['return'].get('total_amount')}")
        else:
            print("  !!!! 'return' NOT FOUND !!!!")

test_all_accounts()
