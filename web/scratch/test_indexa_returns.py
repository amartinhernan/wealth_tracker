import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

INDEXA_TOKEN = os.getenv('INDEXA_TOKEN')
HEADERS = {'X-AUTH-TOKEN': INDEXA_TOKEN}
BASE_URL = 'https://api.indexacapital.com'

def test_indexa():
    try:
        user_res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
        if user_res.status_code == 200:
            accounts = user_res.json().get('accounts', [])
            for acc in accounts:
                acc_num = acc['account_number']
                print(f"Testing returns for account: {acc_num}")
                res = requests.get(f"{BASE_URL}/accounts/{acc_num}/returns", headers=HEADERS)
                print(f"Status Code: {res.status_code}")
                if res.status_code == 200:
                    print(f"Response: {json.dumps(res.json(), indent=2)}")
                else:
                    print(f"Error: {res.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_indexa()
