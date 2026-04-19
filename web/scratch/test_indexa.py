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
            with open('scratch/users_me.json', 'w') as f:
                json.dump(user_res.json(), f, indent=2)
            print("Saved /users/me to scratch/users_me.json")
            
            accounts = user_res.json().get('accounts', [])
            for acc in accounts:
                acc_num = acc['account_number']
                perf_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
                if perf_res.status_code == 200:
                    with open(f'scratch/perf_{acc_num}.json', 'w') as f:
                        json.dump(perf_res.json(), f, indent=2)
                    print(f"Saved performance for {acc_num} up to scratch/perf_{acc_num}.json")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_indexa()
