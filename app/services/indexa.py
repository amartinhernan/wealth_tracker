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

def sync_indexa():
    if not INDEXA_TOKEN:
        return {"status": "error", "message": "Token no configurado en .env"}

    print("Conectando con Indexa Capital...")

    try:
        user_res = requests.get(f"{BASE_URL}/users/me", headers=HEADERS)
        if user_res.status_code != 200:
            return {"status": "error", "message": "Error API"}

        cuentas = user_res.json().get('accounts', [])

        total_actual   = 0.0
        total_invested = 0.0
        total_profit   = 0.0
        main_twr       = 0.0
        main_mwr       = 0.0
        max_amount     = 0.0

        for acc in cuentas:
            acc_num = acc['account_number']
            perf_res = requests.get(f"{BASE_URL}/accounts/{acc_num}/performance", headers=HEADERS)
            if perf_res.status_code != 200:
                continue
            perf_data = perf_res.json()

            ret = perf_data.get('return', {})
            amt = float(ret.get('total_amount', 0.0))
            inv = float(ret.get('investment', ret.get('inflows', 0.0)))
            prof = float(ret.get('pl', amt - inv))
            twr = float(ret.get('time_return', 0.0)) * 100
            mwr = float(ret.get('money_return', 0.0)) * 100

            total_actual   += amt
            total_invested += inv
            total_profit   += prof

            if amt > max_amount:
                max_amount = amt
                main_twr   = twr
                main_mwr   = mwr

        fecha_hoy     = datetime.now().strftime('%Y-%m-%d')
        nombre_activo = "INDEXA CAPITAL - PERFIL 8"

        existing = Asset.query.filter_by(date=fecha_hoy, asset_name=nombre_activo).first()

        if existing:
            existing.actual_money       = total_actual
            existing.total_invest_money = total_invested
            existing.profit_loss        = total_profit
            existing.profit_loss_pct    = main_twr
            existing.avg_buy_price      = main_mwr
        else:
            new_asset = Asset(
                date=fecha_hoy,
                asset_name=nombre_activo,
                portfolio="FUNDS",
                actual_price=0.0,
                avg_buy_price=main_mwr,
                actual_holdings=0.0,
                total_invest_money=total_invested,
                actual_money=total_actual,
                profit_loss=total_profit,
                profit_loss_pct=main_twr
            )
            db.session.add(new_asset)

        db.session.commit()
        print(
            f"Indexa OK | "
            f"Valor: {total_actual:.2f}€ | "
            f"Invertido: {total_invested:.2f}€ | "
            f"Beneficio: {total_profit:.2f}€ | "
            f"TWR: {main_twr:.2f}% | "
            f"MWR: {main_mwr:.2f}%"
        )
        return {"status": "success", "message": "OK", "data": {"actual_money": total_actual}}

    except Exception as e:
        print(f"Error critico: {e}")
        return {"status": "error", "message": str(e)}
