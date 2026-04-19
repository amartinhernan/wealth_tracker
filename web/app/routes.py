import requests
from datetime import datetime
from flask import Blueprint, render_template, jsonify, request
from app.services.returns import calculate_returns
from app.services.indexa import fetch_indexa_data
from app.services.sync import sync_managed_assets
from app.services.pricing import search_tickers, search_crypto
from app.firebase_utils import token_required, get_user_subcollection, db_fs, firestore_to_dict

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def landing():
    return render_template('landing.html')

@main_bp.route('/app')
def index():
    return render_template('index.html')

@main_bp.route('/api/data')
@token_required
def get_data(uid):
    print(f"DEBUG: Petición /api/data para UID: {uid}")
    
    # 1. Obtener configuraciones y historial
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    configs_docs = configs_ref.get()
    config_names = {doc.to_dict()['name']: doc.to_dict() for doc in configs_docs}
    
    assets_ref = get_user_subcollection(uid, 'assets')
    all_assets_docs = assets_ref.order_by('date').get()
    
    print(f"DEBUG: /api/data - Configs: {len(config_names)}, Historial: {len(all_assets_docs)}")
    
    all_assets_ordered = [doc.to_dict() for doc in all_assets_docs]
    hoy = datetime.now().strftime('%Y-%m-%d')

    # Si no hay historial, creamos un estado inicial "vacío" basado en las configuraciones
    if not all_assets_ordered:
        print("DEBUG: /api/data - No hay historial. Generando estado inicial con configs.")
        all_assets_ordered = []
        for c_name, c in config_names.items():
            all_assets_ordered.append({
                "asset_name": c_name, "portfolio": c.get('portfolio', 'OTROS'), 
                "actual_money": 0, "total_invest_money": 0, "date": hoy,
                "actual_price": 0, "actual_holdings": 0, "profit_loss": 0, "profit_loss_pct": 0
            })
        if not all_assets_ordered:
            # Si ni siquiera hay configs, devolvemos estructura mínima para evitar fallos
            return jsonify({
                "summary": {"date": hoy, "total_money": 0, "total_invested": 0, "total_profit": 0, "global_twr": 0, "global_mwr": 0},
                "portfolios_grouped": {},
                "history_global": {"dates": [hoy], "invested": [0], "values": [0]},
                "history_portfolios": {"CASH": [0], "CRYPTO": [0], "FUNDS": [0], "ETFS": [0]},
                "history_assets": {}
            })

    # 2. Foto más reciente de cada activo
    latest_assets_dict = {}
    for a in all_assets_ordered:
        latest_assets_dict[a['asset_name']] = a
        
    current_assets = list(latest_assets_dict.values())
    latest_date = max(a['date'] for a in current_assets)
    
    total_money = sum(a['actual_money'] for a in current_assets)
    total_invested = sum(a['total_invest_money'] for a in current_assets)
    total_profit = total_money - total_invested
    
    # Para los % de rentabilidad, excluir CASH (no genera rendimiento de inversión)
    non_cash_invested = sum(a['total_invest_money'] for a in current_assets if (a.get('portfolio') or '').upper() != 'CASH')
    non_cash_value = sum(a['actual_money'] for a in current_assets if (a.get('portfolio') or '').upper() != 'CASH')
    non_cash_profit = non_cash_value - non_cash_invested

    # 3. Histórico día a día
    all_dates = sorted(list(set(a['date'] for a in all_assets_ordered)))
    running_assets = {}
    global_hist_dict = {}
    hist_by_portfolio = {}
    hist_by_asset = {}
    
    assets_by_date = {}
    for a in all_assets_ordered:
        d = a['date']
        if d not in assets_by_date: assets_by_date[d] = []
        assets_by_date[d].append(a)
        
        name = a['asset_name']
        if name not in hist_by_asset: hist_by_asset[name] = []
        hist_by_asset[name].append((d, a['total_invest_money'], a['actual_money']))
        
    non_cash_hist_dict = {}
    for d in all_dates:
        for a in assets_by_date.get(d, []):
            running_assets[a['asset_name']] = a
            
        global_hist_dict[d] = {
            "inv": sum(a['total_invest_money'] for a in running_assets.values()),
            "val": sum(a['actual_money'] for a in running_assets.values())
        }
        # Historial excluyendo CASH para calcular TWR/MWR de inversión pura
        non_cash_hist_dict[d] = {
            "inv": sum(a['total_invest_money'] for a in running_assets.values() if (a.get('portfolio') or '').upper() != 'CASH'),
            "val": sum(a['actual_money'] for a in running_assets.values() if (a.get('portfolio') or '').upper() != 'CASH')
        }
        
        for a in running_assets.values():
            port = a['portfolio'].upper() if a.get('portfolio') else "OTROS"
            if port not in hist_by_portfolio: hist_by_portfolio[port] = {}
            if d not in hist_by_portfolio[port]: hist_by_portfolio[port][d] = {"inv": 0, "val": 0}
            hist_by_portfolio[port][d]["inv"] += a['total_invest_money']
            hist_by_portfolio[port][d]["val"] += a['actual_money']

    # TWR/MWR calculados SOLO con activos de inversión (sin CASH)
    non_cash_hist_list = [(d, data["inv"], data["val"]) for d, data in non_cash_hist_dict.items()]
    global_twr, global_mwr = calculate_returns(non_cash_hist_list)

    # 4. Agrupar por carteras para la UI
    portfolios_grouped = {}
    assets_to_show = list(current_assets)
    shown_names = {a['asset_name'] for a in assets_to_show}
    
    # Asegurar que incluso los activos en Config sin historial aparezcan (aunque ya lo hicimos arriba, por si acaso)
    for c_name, c in config_names.items():
        if c_name not in shown_names:
            dummy = {
                "asset_name": c_name, "portfolio": c.get('portfolio'), 
                "actual_money": 0, "total_invest_money": 0, "date": latest_date,
                "actual_price": 0, "actual_holdings": 0, "profit_loss": 0, "profit_loss_pct": 0
            }
            assets_to_show.append(dummy)
            hist_by_asset[c_name] = [(latest_date, 0, 0)]

    for a in assets_to_show:
        name = a['asset_name']
        port = a['portfolio'].upper() if a.get('portfolio') else "OTROS"
        if port not in portfolios_grouped:
            portfolios_grouped[port] = {"total_val": 0, "total_inv": 0, "assets": []}
        
        twr, mwr = calculate_returns(hist_by_asset.get(name, [(latest_date, 0, 0)]))
        
        if port == "CASH": twr = mwr = 0.0
        elif "INDEXA" in name.upper():
            twr = a.get('profit_loss_pct', 0.0)
            mwr = a.get('avg_buy_price', 0.0)
            
        portfolios_grouped[port]["total_val"] += a['actual_money']
        portfolios_grouped[port]["total_inv"] += a['total_invest_money']
        portfolios_grouped[port]["assets"].append({
            "name": name, "invested": a['total_invest_money'], "value": a['actual_money'],
            "profit": a.get('profit_loss', 0.0), "twr": twr, "mwr": mwr,
            "price": a.get('actual_price', 0.0), "holdings": a.get('actual_holdings', 0.0),
            "portfolio": port
        })

    # 5. Formatear datos de gráficos
    graph_portfolios = {"CASH": [], "CRYPTO": [], "FUNDS": [], "ETFS": []}
    for d in all_dates:
        vals = {"CASH": 0, "CRYPTO": 0, "FUNDS": 0, "ETFS": 0}
        for p_key, p_data in hist_by_portfolio.items():
            val = p_data.get(d, {}).get("val", 0)
            if "CASH" in p_key: vals["CASH"] += val
            elif "CRYPT" in p_key: vals["CRYPTO"] += val
            elif "FUND" in p_key or "FOND" in p_key: vals["FUNDS"] += val
            elif "ETF" in p_key: vals["ETFS"] += val
            else: vals["FUNDS"] += val # Fallback para que no se pierda en el total
        for k in graph_portfolios: graph_portfolios[k].append(vals[k])

    graph_assets = {}
    for asset_name, history in hist_by_asset.items():
        graph_assets[asset_name] = {
            "dates": [h[0] for h in history],
            "values": [h[2] for h in history],
            "invested": [h[1] for h in history]
        }

    return jsonify(firestore_to_dict({
        "summary": {
            "date": latest_date, "total_money": total_money, "total_invested": total_invested,
            "total_profit": total_profit, "global_twr": global_twr, "global_mwr": global_mwr,
            "non_cash_invested": non_cash_invested, "non_cash_profit": non_cash_profit
        },
        "portfolios_grouped": portfolios_grouped,
        "history_global": {
            "dates": all_dates, 
            "invested": [global_hist_dict[d]["inv"] for d in all_dates],
            "values": [global_hist_dict[d]["val"] for d in all_dates]
        },
        "history_portfolios": graph_portfolios,
        "history_assets": graph_assets
    }))

@main_bp.route('/api/transactions', methods=['GET'])
@token_required
def get_transactions(uid):
    tx_ref = get_user_subcollection(uid, 'transactions')
    transactions = tx_ref.order_by('date', direction='DESCENDING').get()
    
    res = []
    for t_doc in transactions:
        t = t_doc.to_dict()
        res.append({
            'id': t_doc.id,
            'date': t['date'].strftime('%Y-%m-%d') if t.get('date') else None,
            'description': t.get('description', ''),
            'amount': t.get('amount', 0),
            'source': t.get('source', ''),
            'category': t.get('category_name', t.get('category', 'Otros')),
            'category_id': t.get('category_id'),
            'subcategory': t.get('subcategory_name', t.get('subcategory', 'Otros')),
            'subcategory_id': t.get('subcategory_id'),
            'is_reviewed': t.get('is_reviewed', False),
            'is_income': t.get('is_income', False),
            'linked_transaction_id': t.get('linked_transaction_id')
        })
    return jsonify(res)

@main_bp.route('/api/transactions/<id>', methods=['PATCH', 'PUT'])
@token_required
def update_transaction(uid, id):
    data = request.json
    tx_ref = get_user_subcollection(uid, 'transactions').document(id)
    
    # Mapeo de campos frontend a Firestore
    update_data = {}
    if 'category' in data: 
        update_data['category_name'] = data['category']
        update_data['category'] = data['category'] # Double save for compatibility
    if 'category_id' in data: update_data['category_id'] = data['category_id']
    if 'subcategory' in data: 
        update_data['subcategory_name'] = data['subcategory']
        update_data['subcategory'] = data['subcategory']
    if 'subcategory_id' in data: update_data['subcategory_id'] = data['subcategory_id']
    if 'is_reviewed' in data: update_data['is_reviewed'] = data['is_reviewed']
    if 'is_income' in data: update_data['is_income'] = data['is_income']
    if 'linked_transaction_id' in data: update_data['linked_transaction_id'] = data['linked_transaction_id']
    
    tx_ref.update(update_data)
    return jsonify({"status": "success"})

@main_bp.route('/api/categories', methods=['GET'])
@token_required
def get_categories(uid):
    cat_ref = get_user_subcollection(uid, 'categories')
    sub_ref = get_user_subcollection(uid, 'subcategories')
    
    cats = [doc.to_dict() for doc in cat_ref.get()]
    # Añadir ID a cada categoría
    for i, c_doc in enumerate(cat_ref.get()):
        cats[i]['id'] = c_doc.id
        
    subs = [doc.to_dict() for doc in sub_ref.get()]
    for i, s_doc in enumerate(sub_ref.get()):
        subs[i]['id'] = s_doc.id
        
    # Organizar jerárquicamente para el frontend
    res = []
    for c in cats:
        c_subs = [s for s in subs if str(s.get('category_id')) == str(c.get('id'))]
        res.append({
            'id': c.get('id'),
            'name': c.get('name'),
            'subcategories': [{'id': s.get('id'), 'name': s.get('name')} for s in c_subs]
        })
    return jsonify(res)

@main_bp.route('/api/categories', methods=['POST'])
@token_required
def add_category(uid):
    data = request.json
    if not data.get('name'): return jsonify({"error": "Name required"}), 400
    
    cat_ref = get_user_subcollection(uid, 'categories')
    # Usar timestamp como ID para mantener consistencia con los IDs de SQLite migrados
    new_id = str(int(datetime.now().timestamp() * 1000))
    cat_ref.document(new_id).set({'name': data['name']})
    return jsonify({"status": "success", "id": new_id})

@main_bp.route('/api/configs', methods=['GET'])
@token_required
def get_configs(uid):
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    configs = [doc.to_dict() for doc in configs_ref.get()]
    for i, doc in enumerate(configs_ref.get()):
        configs[i]['id'] = doc.id
    return jsonify(configs)

@main_bp.route('/api/configs', methods=['POST'])
@token_required
def save_config(uid):
    data = request.json
    name = data.get('name')
    if not name: return jsonify({"error": "Name required"}), 400
    
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    # Usamos el nombre como ID para facilitar la vinculación con snapshots
    configs_ref.document(name).set(data)
    return jsonify({"status": "success"})

@main_bp.route('/api/configs/<name>', methods=['DELETE'])
@token_required
def delete_config(uid, name):
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    configs_ref.document(name).delete()
    return jsonify({"status": "success"})

@main_bp.route('/api/search')
@token_required
def search(uid):
    q = request.args.get('q', '')
    portfolio = request.args.get('portfolio', '')
    if portfolio == 'CRYPTO':
        return jsonify(search_crypto(q))
    return jsonify(search_tickers(q))

@main_bp.route('/api/sync/all', methods=['POST'])
@token_required
def sync_all(uid):
    try:
        sync_managed_assets(uid)
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"Error in sync_all: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/portfolio/analysis', methods=['POST'])
@token_required
def portfolio_analysis(uid):
    data = request.json
    # Esta ruta suele llamar a un servicio de IA para analizar el portfolio
    # Por ahora devolvemos un placeholder o el resultado de un análisis básico
    return jsonify({
        "analysis": "Tu cartera tiene una buena diversificación. Considera aumentar el peso en ETFs si buscas menos volatilidad.",
        "risk_level": "Moderado"
    })
