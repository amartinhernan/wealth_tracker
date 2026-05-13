"""
Muestra la estructura exacta de la respuesta del API de Indexa.
Uso: python debug_indexa.py
"""
import sys, json
sys.path.append('c:/Users/alexd/Desktop/ALEJANDRO/PROYECTOS/TRACKEO INVERSIONES Y GASTOS/wealth_tracker/web')

from app import create_app
app = create_app()
with app.app_context():
    import requests, os
    from dotenv import load_dotenv
    load_dotenv('c:/Users/alexd/Desktop/ALEJANDRO/PROYECTOS/TRACKEO INVERSIONES Y GASTOS/wealth_tracker/.env')

    token = os.getenv('INDEXA_TOKEN')
    if not token:
        print("ERROR: INDEXA_TOKEN no encontrado en .env")
        sys.exit(1)

    headers = {'X-AUTH-TOKEN': token}
    BASE = 'https://api.indexacapital.com'

    user = requests.get(f'{BASE}/users/me', headers=headers).json()
    accounts = user.get('accounts', []) + user.get('insurances', []) + user.get('pension_plans', [])

    for acc in accounts[:2]:  # primeras 2 cuentas
        acc_num = acc.get('account_number')
        if not acc_num:
            continue
        print(f"\n{'='*60}")
        print(f"Cuenta: {acc_num}")
        perf = requests.get(f'{BASE}/accounts/{acc_num}/performance', headers=headers).json()

        # Mostrar claves top-level
        print(f"Claves top-level: {list(perf.keys())}")

        # 'return' object
        ret = perf.get('return', {})
        if ret:
            print(f"\n[return] claves: {list(ret.keys()) if isinstance(ret, dict) else type(ret)}")
            print(f"  total_amount={ret.get('total_amount')}, investment={ret.get('investment')}, pl={ret.get('pl')}")

        # 'history' object - lo que nos interesa para snapshots mensuales
        hist = perf.get('history', {})
        print(f"\n[history] tipo: {type(hist).__name__}, claves: {list(hist.keys()) if isinstance(hist, dict) else 'N/A (lista)'}")
        if isinstance(hist, dict):
            for k, v in hist.items():
                if isinstance(v, list):
                    print(f"  '{k}': lista de {len(v)} elementos, primeros 3: {v[:3]}, ultimos 3: {v[-3:]}")
                else:
                    print(f"  '{k}': {v}")
        elif isinstance(hist, list) and hist:
            print(f"  Lista de {len(hist)} elementos")
            print(f"  Primer elemento: {json.dumps(hist[0], indent=4)}")
            print(f"  Ultimo elemento: {json.dumps(hist[-1], indent=4)}")

        # 'net_amounts' top-level
        na = perf.get('net_amounts', {})
        print(f"\n[net_amounts] tipo: {type(na).__name__}")
        if isinstance(na, dict):
            items = list(na.items())
            print(f"  {len(items)} entradas, primeras 3: {items[:3]}, ultimas 3: {items[-3:]}")
        elif isinstance(na, list):
            print(f"  lista de {len(na)}, primeros 3: {na[:3]}, ultimos 3: {na[-3:]}")

        # 'return.total_amounts'
        ret_amounts = ret.get('total_amounts') if isinstance(ret, dict) else None
        if ret_amounts is not None:
            print(f"\n[return.total_amounts] tipo: {type(ret_amounts).__name__}")
            if isinstance(ret_amounts, dict):
                items = list(ret_amounts.items())
                print(f"  {len(items)} entradas, primeras 3: {items[:3]}, ultimas 3: {items[-3:]}")
            elif isinstance(ret_amounts, list):
                print(f"  lista de {len(ret_amounts)}, primeros 3: {ret_amounts[:3]}, ultimos 3: {ret_amounts[-3:]}")

        # 'portfolios' top-level
        portfolios = perf.get('portfolios', {})
        print(f"\n[portfolios] tipo: {type(portfolios).__name__}")
        if isinstance(portfolios, dict) and portfolios:
            for k, v in list(portfolios.items())[:2]:
                print(f"  '{k}': {str(v)[:120]}")
        elif isinstance(portfolios, list) and portfolios:
            print(f"  lista de {len(portfolios)}, primer elem keys: {list(portfolios[0].keys()) if isinstance(portfolios[0], dict) else 'N/A'}")
