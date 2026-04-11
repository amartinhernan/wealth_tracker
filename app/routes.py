from flask import Blueprint, render_template, jsonify
from app.models import Asset
from app.services.returns import calculate_returns
from app.services.indexa import sync_indexa

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    return render_template('index.html')

@main_bp.route('/api/data')
def get_data():
    all_assets_ordered = Asset.query.order_by(Asset.date.asc()).all()
    if not all_assets_ordered:
        return jsonify({"error": "No data"})
    
    # 1. Foto más reciente de cada activo
    latest_assets_dict = {}
    for a in all_assets_ordered:
        latest_assets_dict[a.asset_name] = a
        
    current_assets = list(latest_assets_dict.values())
    latest_date = max(a.date for a in current_assets)
    
    total_money = sum(a.actual_money for a in current_assets)
    total_invested = sum(a.total_invest_money for a in current_assets)
    total_profit = total_money - total_invested

    # 2. Histórico día a día
    all_dates = sorted(list(set(a.date for a in all_assets_ordered)))
    running_assets = {}
    global_hist_dict = {}
    hist_by_portfolio = {}
    
    assets_by_date = {}
    for a in all_assets_ordered:
        if a.date not in assets_by_date:
            assets_by_date[a.date] = []
        assets_by_date[a.date].append(a)
        
    for d in all_dates:
        for a in assets_by_date.get(d, []):
            running_assets[a.asset_name] = a
            
        global_hist_dict[d] = {
            "inv": sum(a.total_invest_money for a in running_assets.values()),
            "val": sum(a.actual_money for a in running_assets.values())
        }
        
        for a in running_assets.values():
            port = a.portfolio.upper() if a.portfolio else "OTROS"
            if port not in hist_by_portfolio:
                hist_by_portfolio[port] = {}
            if d not in hist_by_portfolio[port]:
                hist_by_portfolio[port][d] = {"inv": 0, "val": 0}
            hist_by_portfolio[port][d]["inv"] += a.total_invest_money
            hist_by_portfolio[port][d]["val"] += a.actual_money

    global_hist_list = [(d, data["inv"], data["val"]) for d, data in global_hist_dict.items()]
    global_twr, global_mwr = calculate_returns(global_hist_list)

    # 3. Datos para la interfaz
    portfolios_grouped = {}
    hist_by_asset = {}
    
    for a in all_assets_ordered:
        if a.asset_name not in hist_by_asset:
            hist_by_asset[a.asset_name] = []
        hist_by_asset[a.asset_name].append((a.date, a.total_invest_money, a.actual_money))

    for a in current_assets:
        if a.actual_money > 0 or a.total_invest_money > 0:
            port = a.portfolio.upper() if a.portfolio else "OTROS"
            if port not in portfolios_grouped:
                portfolios_grouped[port] = {"total_val": 0, "total_inv": 0, "assets": []}
            
            twr, mwr = calculate_returns(hist_by_asset[a.asset_name])
            
            if "INDEXA" in a.asset_name.upper():
                twr = a.profit_loss_pct
                mwr = a.avg_buy_price
                
            portfolios_grouped[port]["total_val"] += a.actual_money
            portfolios_grouped[port]["total_inv"] += a.total_invest_money
            portfolios_grouped[port]["assets"].append({
                "name": a.asset_name, "invested": a.total_invest_money, "value": a.actual_money,
                "profit": a.profit_loss, "twr": twr, "mwr": mwr
            })

    # 4. Alinear áreas apiladas
    graph_portfolios = {"CASH": [], "CRYPTO": [], "FUNDS": [], "ETFS": []}
    for d in all_dates:
        vals = {"CASH": 0, "CRYPTO": 0, "FUNDS": 0, "ETFS": 0}
        for p_key, p_data in hist_by_portfolio.items():
            if "CASH" in p_key: vals["CASH"] += p_data.get(d, {}).get("val", 0)
            elif "CRYPT" in p_key: vals["CRYPTO"] += p_data.get(d, {}).get("val", 0)
            elif "FUND" in p_key or "FOND" in p_key: vals["FUNDS"] += p_data.get(d, {}).get("val", 0)
            elif "ETF" in p_key: vals["ETFS"] += p_data.get(d, {}).get("val", 0)
        graph_portfolios["CASH"].append(vals["CASH"])
        graph_portfolios["CRYPTO"].append(vals["CRYPTO"])
        graph_portfolios["FUNDS"].append(vals["FUNDS"])
        graph_portfolios["ETFS"].append(vals["ETFS"])

    graph_assets = {}
    for asset_name, history in hist_by_asset.items():
        graph_assets[asset_name] = {
            "dates": [h[0] for h in history],
            "values": [h[2] for h in history],
            "invested": [h[1] for h in history]
        }

    return jsonify({
        "summary": {
            "date": latest_date, "total_money": total_money, "total_invested": total_invested,
            "total_profit": total_profit, "global_twr": global_twr, "global_mwr": global_mwr
        },
        "portfolios_grouped": portfolios_grouped,
        "history_global": {"dates": all_dates, "invested": [global_hist_dict[d]["inv"] for d in all_dates]},
        "history_portfolios": graph_portfolios,
        "history_assets": graph_assets
    })

@main_bp.route('/api/sync/indexa', methods=['POST'])
def trigger_sync_indexa():
    result = sync_indexa()
    return jsonify(result)
