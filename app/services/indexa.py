import requests
import os
from datetime import datetime
from flask import current_app
from app.models import db, Asset
from dotenv import load_dotenv

load_dotenv()

INDEXA_TOKEN = os.getenv('INDEXA_TOKEN')
HEADERS = {'X-AUTH-TOKEN': INDEXA_TOKEN}
BASE_URL = 'https://api.indexacapital.com'

def fetch_indexa_data():
    """Obtiene los datos agregados de Indexa Capital sin persistir en la DB."""
    if not INDEXA_TOKEN:
        return {"status": "error", "message": "Token no configurado en .env"}

    try:
        print(f"DEBUG: Indexa - Fetching data with token: {INDEXA_TOKEN[:10]}...")
        user_res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
        if user_res.status_code != 200:
            print(f"DEBUG: Indexa - Error fetching /users/me: {user_res.status_code} - {user_res.text}")
            return {"status": "error", "message": f"Error API Indexa: {user_res.status_code}"}

        cuentas = user_res.json().get('accounts', [])
        print(f"DEBUG: Indexa - Found {len(cuentas)} accounts.")
        total_actual = 0.0
        total_invested = 0.0
        total_profit = 0.0
        main_twr = 0.0
        main_mwr = 0.0
        max_amount = 0.0

        for acc in cuentas:
            acc_num = acc['account_number']
            perf_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
            if perf_res.status_code != 200:
                print(f"DEBUG: Indexa - Error fetching performance for {acc_num}: {perf_res.status_code}")
                continue
            
            perf_data = perf_res.json()
            ret = perf_data.get('return', {})
            amt = float(ret.get('total_amount', 0.0))
            inv = float(ret.get('investment', ret.get('inflows', 0.0)))
            prof = float(ret.get('pl', amt - inv))
            twr = float(ret.get('time_return', 0.0)) * 100
            mwr = float(ret.get('money_return', 0.0)) * 100

            print(f"DEBUG: Indexa - Acc {acc_num}: Val={amt}, Inv={inv}, TWR={twr}")

            total_actual += amt
            total_invested += inv
            total_profit += prof

            if amt > max_amount:
                max_amount = amt
                main_twr = twr
                main_mwr = mwr

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
        print(f"DEBUG: Indexa - Exception: {str(e)}")
        return {"status": "error", "message": str(e)}

def sync_indexa():
    """Sincroniza el activo por defecto de Indexa Capital."""
    res = fetch_indexa_data()
    if res["status"] == "error":
        return res

    d = res["data"]
    fecha_hoy = datetime.now().strftime('%Y-%m-%d')
    nombre_activo = "INDEXA CAPITAL - PERFIL 8"

    existing = Asset.query.filter_by(date=fecha_hoy, asset_name=nombre_activo).first()
    if existing:
        existing.actual_money       = d["actual_money"]
        existing.total_invest_money = d["total_invested"]
        existing.profit_loss        = d["profit_loss"]
        existing.profit_loss_pct    = d["twr"]
        existing.avg_buy_price      = d["mwr"]
    else:
        new_asset = Asset(
            date=fecha_hoy,
            asset_name=nombre_activo,
            portfolio="FUNDS",
            actual_price=0.0,
            avg_buy_price=d["mwr"],
            actual_holdings=0.0,
            total_invest_money=d["total_invested"],
            actual_money=d["actual_money"],
            profit_loss=d["profit_loss"],
            profit_loss_pct=d["twr"]
        )
        db.session.add(new_asset)

    db.session.commit()
    return {"status": "success", "message": "OK", "data": d}
