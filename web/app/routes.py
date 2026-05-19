import requests
import pandas as pd
import io
import os
from datetime import datetime
from difflib import SequenceMatcher
from flask import Blueprint, render_template, jsonify, request
from app.services.returns import calculate_returns
from app.services.indexa import fetch_indexa_data
from app.services.sync import sync_managed_assets
from app.services.pricing import search_tickers, search_crypto
from app.services.parsers import BankParser
from app.services.ai_categorizer import AICategorizer
from app.services.ai_parser import AIParser
from app.firebase_utils import token_required, get_user_subcollection, db_fs, firestore_to_dict

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def landing():
    return render_template('landing.html')

@main_bp.route('/app')
def index():
    return render_template('index.html')

# ── Bank favicon dominant-edge-color detection ────────────────────────────
# Fetched once, cached in memory for the lifetime of the process.
_favicon_color_cache: dict = {}
_favicon_lock = None

_BANK_FAVICON_DOMAINS = {
    'SANTANDER':     'santander.com',
    'BBVA':          'bbva.com',
    'CAIXABANK':     'caixabank.com',
    'SABADELL':      'bancosabadell.com',
    'ING':           'ing.es',
    'BANKINTER':     'bankinter.com',
    'OPENBANK':      'openbank.es',
    'ABANCA':        'abanca.com',
    'KUTXABANK':     'kutxabank.es',
    'UNICAJA':       'unicajabanco.es',
    'IBERCAJA':      'ibercaja.es',
    'CAJAMAR':       'cajamar.es',
    'TRADEREPUBLIC': 'traderepublic.com',
    'MYINVESTOR':    'myinvestor.es',
    'REVOLUT':       'revolut.com',
    'N26':           'n26.com',
    'WISE':          'wise.com',
    'EDENRED':       'edenred.es',
}

def _dominant_edge_color(domain: str) -> str:
    """
    Fetch the 64×64 favicon for domain and return the dominant color found
    on the 4 edges (top, bottom, left, right rows/columns).
    Transparent and near-white pixels are ignored.
    Returns '#ffffff' if no coloured pixels found.
    """
    try:
        from PIL import Image
        from collections import Counter
        url = f'https://www.google.com/s2/favicons?domain={domain}&sz=64'
        r = requests.get(url, timeout=6, headers={'User-Agent': 'Mozilla/5.0'})
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content)).convert('RGBA')
        w, h = img.size
        px = list(img.getdata())

        # Collect all 4 border rows/columns
        edge = []
        for x in range(w):
            edge.append(px[x])            # top row
            edge.append(px[(h - 1) * w + x])  # bottom row
        for y in range(h):
            edge.append(px[y * w])        # left col
            edge.append(px[y * w + w - 1])    # right col

        counts: Counter = Counter()
        for rv, gv, bv, av in edge:
            if av < 128:
                continue                          # transparent
            if rv >= 230 and gv >= 230 and bv >= 230:
                continue                          # near-white
            # Quantise to 24-step buckets to merge similar shades
            counts[(rv // 24 * 24, gv // 24 * 24, bv // 24 * 24)] += 1

        if not counts:
            return '#ffffff'

        r3, g3, b3 = counts.most_common(1)[0][0]
        return f'#{r3:02x}{g3:02x}{b3:02x}'
    except Exception as exc:
        print(f'favicon color {domain}: {exc}')
        return '#ffffff'

@main_bp.route('/api/bank-favicon-colors')
def bank_favicon_colors():
    """
    Return dominant edge colours for all supported bank favicons.
    No auth required — these are public brand assets.
    Results are cached in memory so the heavy lifting only runs once.
    """
    global _favicon_color_cache, _favicon_lock
    import threading
    if _favicon_lock is None:
        _favicon_lock = threading.Lock()

    with _favicon_lock:
        if not _favicon_color_cache:
            result = {}
            for source, domain in _BANK_FAVICON_DOMAINS.items():
                result[source] = _dominant_edge_color(domain)
            _favicon_color_cache = result

    return jsonify(_favicon_color_cache)

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
    graph_portfolios_inv = {"CASH": [], "CRYPTO": [], "FUNDS": [], "ETFS": []}
    for d in all_dates:
        vals = {"CASH": 0, "CRYPTO": 0, "FUNDS": 0, "ETFS": 0}
        invs = {"CASH": 0, "CRYPTO": 0, "FUNDS": 0, "ETFS": 0}
        for p_key, p_data in hist_by_portfolio.items():
            val = p_data.get(d, {}).get("val", 0)
            inv = p_data.get(d, {}).get("inv", 0)
            if "CASH" in p_key:
                vals["CASH"] += val; invs["CASH"] += inv
            elif "CRYPT" in p_key:
                vals["CRYPTO"] += val; invs["CRYPTO"] += inv
            elif "FUND" in p_key or "FOND" in p_key:
                vals["FUNDS"] += val; invs["FUNDS"] += inv
            elif "ETF" in p_key:
                vals["ETFS"] += val; invs["ETFS"] += inv
            else:
                vals["FUNDS"] += val; invs["FUNDS"] += inv
        for k in graph_portfolios:
            graph_portfolios[k].append(vals[k])
            graph_portfolios_inv[k].append(invs[k])

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
        "history_portfolios_inv": graph_portfolios_inv,
        "history_assets": graph_assets
    }))

@main_bp.route('/api/transactions', methods=['POST'])
@token_required
def create_transaction_manual(uid):
    data = request.json or {}
    tx_ref = get_user_subcollection(uid, 'transactions')
    date_str = data.get('date') or datetime.now().strftime('%Y-%m-%d')
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        date_obj = datetime.now()
    amount = float(data.get('amount', 0))
    doc = {
        'date': date_obj,
        'description': data.get('description', ''),
        'amount': amount,
        'source': data.get('source', 'CASH'),
        'category_name': data.get('category', ''),
        'category': data.get('category', ''),
        'subcategory_name': '',
        'subcategory': '',
        'is_reviewed': True,
        'is_income': amount > 0,
        'linked_transaction_id': None,
        'manual': True,
    }
    ref = tx_ref.add(doc)
    return jsonify({'status': 'created', 'id': ref[1].id}), 201

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
    if 'description' in data: update_data['description'] = data['description']
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
    name = data.get('name')
    if not name: return jsonify({"error": "Name required"}), 400
    
    cat_ref = get_user_subcollection(uid, 'categories')
    cat_id = data.get('id')
    
    if cat_id:
        # Update existing
        cat_ref.document(cat_id).update({'name': name})
        return jsonify({"status": "success", "id": cat_id})
    else:
        # Create new
        new_id = str(int(datetime.now().timestamp() * 1000))
        cat_ref.document(new_id).set({'name': name})
        return jsonify({"status": "success", "id": new_id})

@main_bp.route('/api/categories/<id>', methods=['DELETE'])
@token_required
def delete_category(uid, id):
    try:
        cat_ref = get_user_subcollection(uid, 'categories')
        cat_ref.document(id).delete()
        # Also delete associated subcategories for cleanliness
        subs_ref = get_user_subcollection(uid, 'subcategories')
        subs = subs_ref.where('category_id', '==', id).get()
        for s in subs:
            s.reference.delete()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/subcategories', methods=['POST'])
@token_required
def save_subcategory(uid):
    data = request.json
    name = data.get('name')
    if not name: return jsonify({"error": "Name required"}), 400
    
    sub_ref = get_user_subcollection(uid, 'subcategories')
    sub_id = data.get('id')
    
    if sub_id:
        # Update existing
        sub_ref.document(sub_id).update({'name': name})
        return jsonify({"status": "success", "id": sub_id})
    else:
        # Create new
        cat_id = data.get('category_id')
        if not cat_id: return jsonify({"error": "Category ID required"}), 400
        new_id = str(int(datetime.now().timestamp() * 1000 + 1))
        sub_ref.document(new_id).set({'name': name, 'category_id': cat_id})
        return jsonify({"status": "success", "id": new_id})

@main_bp.route('/api/subcategories/<id>', methods=['DELETE'])
@token_required
def delete_subcategory(uid, id):
    try:
        sub_ref = get_user_subcollection(uid, 'subcategories')
        sub_ref.document(id).delete()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

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
    from datetime import datetime, date, timezone
    data = request.json
    name = data.get('name')
    if not name: return jsonify({"error": "Name required"}), 400

    configs_ref = get_user_subcollection(uid, 'asset_configs')

    today_str = date.today().isoformat()

    if data.get('subtype') == 'cash' and data.get('type') == 'auto':
        existing_doc = configs_ref.document(name).get()
        existing = existing_doc.to_dict() if existing_doc.exists else {}

        new_holdings = data.get('holdings')
        old_holdings = existing.get('holdings')
        balance_changed = (new_holdings is not None) and (new_holdings != old_holdings)

        if balance_changed or not existing_doc.exists:
            # Store the exact moment the user set this manual balance.
            # Sync will include only transactions whose created_at (inventoried time)
            # is strictly AFTER this timestamp — regardless of their transaction date.
            data['manual_balance_datetime'] = datetime.now(timezone.utc)
            data['manual_balance_date'] = today_str  # kept for legacy fallback only
        else:
            # Preserve existing cutoffs — user changed a different field, not the balance.
            for field in ('manual_balance_datetime', 'manual_balance_date'):
                existing_val = existing.get(field)
                if existing_val:
                    data[field] = existing_val

    # Preserve existing Indexa token if the user didn't re-enter it (empty field on edit)
    if data.get('subtype') == 'indexa' and not data.get('indexa_token'):
        existing_doc = configs_ref.document(name).get()
        if existing_doc.exists:
            stored_token = existing_doc.to_dict().get('indexa_token')
            if stored_token:
                data['indexa_token'] = stored_token

    data['updated_at'] = datetime.now(timezone.utc)
    configs_ref.document(name).set(data)
    return jsonify({"status": "success", "manual_balance_date": data.get('manual_balance_date', today_str)})
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
    import os, json as _json
    data = request.json or {}
    portfolio_str = data.get('portfolio', '{}')

    groq_key = os.getenv('GROQ_API_KEY')
    if groq_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)
            prompt = f"""Eres un asesor financiero experto analizando el portfolio de un inversor particular español.
Datos del portfolio: {portfolio_str}

Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones fuera del JSON.

IMPORTANTE — reglas estrictas:
- NO repitas números que el usuario ya ve en pantalla (valor total, beneficio, %).
- Sí menciona si algo es bueno, malo o mejorable en comparación con benchmarks o buenas prácticas.
- Cada insight debe ser una recomendación accionable o una conclusión no obvia.
- Tono directo, sin relleno, sin elogios vacíos.

Formato requerido:
{{"summary": "Una frase que evalúe la salud global del portfolio (comparación con benchmark, riesgo, concentración).",
"items": [
  {{"icon": "📊", "text": "Insight accionable 1 (< 90 chars)"}},
  {{"icon": "⚡", "text": "Insight accionable 2 (< 90 chars)"}},
  {{"icon": "🎯", "text": "Insight accionable 3 (< 90 chars)"}}
]}}"""
            resp = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=350
            )
            text = resp.choices[0].message.content.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"): text = text[4:]
            result = _json.loads(text)
            return jsonify(result)
        except Exception as e:
            print(f"DEBUG: Groq portfolio analysis error: {e}")

    # Fallback: rule-based insights (non-obvious observations only)
    try:
        p = _json.loads(portfolio_str)
        total = p.get('totalValue', 0) or 1
        profit = p.get('totalProfit', 0)
        invested = p.get('totalInvested', 0) or 1
        twr = p.get('twr', 0)
        dist = p.get('distribution', {})
        cash_val  = dist.get('CASH',   {}).get('total_val', 0)
        etfs_val  = dist.get('ETFS',   {}).get('total_val', 0)
        funds_val = dist.get('FUNDS',  {}).get('total_val', 0)
        crypto_val = dist.get('CRYPTO',{}).get('total_val', 0)
        cash_pct   = cash_val  / total * 100
        inv_pct    = (etfs_val + funds_val + crypto_val) / total * 100
        crypto_pct = crypto_val / total * 100

        items = []
        # Cash concentration insight
        if cash_pct > 50:
            items.append({"icon": "💡", "text": "Más de la mitad en efectivo: la inflación erosiona su valor. Considera DCA en fondos."})
        elif cash_pct > 30:
            items.append({"icon": "💡", "text": f"Colchón de liquidez amplio. Asegúrate de que el exceso esté en cuenta remunerada."})
        elif cash_pct < 5 and inv_pct > 80:
            items.append({"icon": "⚠️", "text": "Liquidez muy baja. Mantén 3-6 meses de gastos en efectivo antes de invertir más."})

        # TWR vs market benchmark
        if twr > 10:
            items.append({"icon": "🏆", "text": f"TWR superior al 10%: estás batiendo la rentabilidad media de los fondos españoles."})
        elif 5 < twr <= 10:
            items.append({"icon": "📈", "text": "Rentabilidad en línea con el mercado. Revisa si los costes de gestión son competitivos."})
        elif 0 < twr <= 5:
            items.append({"icon": "🔍", "text": "Rentabilidad por debajo del S&P 500 histórico (~10% anual). Evalúa la asignación."})

        # Crypto concentration risk
        if crypto_pct > 20:
            items.append({"icon": "⚡", "text": f"Alta exposición a crypto ({crypto_pct:.0f}%). Activo de alta volatilidad — revisa si encaja con tu perfil."})
        elif crypto_pct == 0 and inv_pct > 0:
            items.append({"icon": "🎯", "text": "Sin exposición a crypto: perfil conservador. Un 5% podría mejorar el potencial de retorno."})

        if not items:
            items.append({"icon": "✅", "text": "Portfolio equilibrado. Mantén las aportaciones periódicas para aprovechar el interés compuesto."})

        pct = profit / invested * 100
        trend = "por encima" if twr > 7 else "por debajo"
        summary = f"Rentabilidad {trend} de la media histórica del mercado. El {cash_pct:.0f}% en efectivo {'limita' if cash_pct>35 else 'complementa'} tu exposición inversora."
        return jsonify({"summary": summary, "items": items[:3]})
    except Exception:
        return jsonify({"summary": "Análisis no disponible.", "items": []})

def _norm_desc(description: str) -> str:
    """Lowercase + collapsed whitespace.  'PAGO ZARA' == 'Pago Zara' == 'pago  zara'."""
    return ' '.join(str(description).lower().strip().split())


def _desc_similar(a: str, b: str, threshold: float = 0.85) -> bool:
    """True if two normalised descriptions are ≥threshold similar.
    Catches minor differences like 'Concepto: Sesion' vs 'Concepto Sesion'."""
    if a == b:
        return True
    return SequenceMatcher(None, a, b).ratio() >= threshold


def _dedup_sig(date_str: str, amount: float, description: str, source: str) -> tuple:
    """Normalised dedup key — case-insensitive, whitespace-collapsed description."""
    return (date_str, round(float(amount), 2), _norm_desc(description), source)


_BANK_PARSERS = {
    'REVOLUT':       BankParser.parse_revolut,
    'SANTANDER':     BankParser.parse_santander,
    'EDENRED':       BankParser.parse_edenred,
    'BBVA':          BankParser.parse_bbva,
    'CAIXABANK':     BankParser.parse_caixabank,
    'SABADELL':      BankParser.parse_sabadell,
    'ING':           BankParser.parse_ing,
    'BANKINTER':     BankParser.parse_bankinter,
    'OPENBANK':      BankParser.parse_openbank,
    'N26':           BankParser.parse_n26,
    'WISE':          BankParser.parse_wise,
    'ABANCA':        BankParser.parse_abanca,
    'KUTXABANK':     BankParser.parse_kutxabank,
    'UNICAJA':       BankParser.parse_unicaja,
    'IBERCAJA':      BankParser.parse_ibercaja,
    'CAJAMAR':       BankParser.parse_cajamar,
    'EVOBANK':       BankParser.parse_evobank,
    'MYINVESTOR':    BankParser.parse_myinvestor,
    'TRADEREPUBLIC': BankParser.parse_traderepublic,
}


@main_bp.route('/api/transactions/import', methods=['POST'])
@token_required
def import_transactions(uid):
    source = request.form.get('source')
    file = request.files.get('file')

    if not file:
        return jsonify({'error': 'No file uploaded'}), 400

    file_content = file.read()

    # ── 1. Try AI-powered universal parser first ──────────────────────────
    items = []
    try:
        ai = AIParser()
        items = ai.parse_universal(file_content, source)
        print(f'[import] AI parser returned {len(items)} rows for {source}')
    except Exception as e:
        print(f'[import] AI parser exception: {e}')
        items = []

    # ── 2. Fall back to rule-based parser if AI got <3 results ───────────
    if len(items) < 3:
        parser_fn = _BANK_PARSERS.get(source)
        if not parser_fn:
            if not items:
                return jsonify({'error': f'Fuente no soportada: {source}'}), 400
        else:
            fallback = parser_fn(file_content)
            if len(fallback) > len(items):
                print(f'[import] using rule-based fallback: {len(fallback)} rows')
                items = fallback

    # ── 3. Existing transactions → fuzzy-date dedup ───────────────────────
    tx_ref = get_user_subcollection(uid, 'transactions')
    existing_docs = tx_ref.get()

    # Build list for fuzzy matching: same desc+amount+source, date within ±4 days.
    # This tolerates the difference between "operation date" (mobile export) and
    # "settlement date" (web export) that Santander and other banks use.
    existing_txs = []
    for doc in existing_docs:
        d = doc.to_dict()
        dt = d.get('date')
        if hasattr(dt, 'strftime'):
            dt_naive = dt.replace(tzinfo=None) if getattr(dt, 'tzinfo', None) else dt
        else:
            try:
                dt_naive = datetime.strptime(str(dt)[:10], '%Y-%m-%d')
            except Exception:
                continue
        existing_txs.append({
            'date':   dt_naive,
            'amount': round(float(d.get('amount', 0)), 2),
            'desc':   _norm_desc(d.get('description', '')),
            'source': d.get('source', ''),
        })

    def _fuzzy_dup(item_dt, amount, description, source, max_days=4):
        amt  = round(float(amount), 2)
        desc = _norm_desc(description)
        naive = item_dt.replace(tzinfo=None) if getattr(item_dt, 'tzinfo', None) else item_dt
        for ex in existing_txs:
            if ex['source'] != source or ex['amount'] != amt:
                continue
            if not _desc_similar(ex['desc'], desc):
                continue
            if abs((naive - ex['date']).days) <= max_days:
                return True
        return False

    new_count = 0
    # Also track sigs seen in this batch to avoid duplicates within the same file
    batch_sigs = set()
    debug_log = []
    def log(msg):
        debug_log.append(f"{datetime.now().isoformat()} - {msg}")

    log(f"Iniciando importación de {len(items)} transacciones para {source}")

    categorizer = AICategorizer()

    # Cache de categorías y subcategorías
    cat_ref = get_user_subcollection(uid, 'categories')
    cat_docs = cat_ref.get()
    cat_map = {doc.to_dict()['name'].lower(): doc.id for doc in cat_docs}

    sub_ref = get_user_subcollection(uid, 'subcategories')
    sub_docs = sub_ref.get()
    sub_map = {}
    for s_doc in sub_docs:
        s = s_doc.to_dict()
        key = f"{s.get('category_id')}_{s.get('name', '').lower()}"
        sub_map[key] = s_doc.id

    for item in items:
        dt_str = item['date'].strftime('%Y-%m-%d')
        sig = _dedup_sig(dt_str, item['amount'], item['description'], item['source'])

        if _fuzzy_dup(item['date'], item['amount'], item['description'], item['source']) or sig in batch_sigs:
            log(f"IGNORADA (Duplicada): {dt_str} - {item['amount']} - {item['description'][:30]}")
            continue
        batch_sigs.add(sig)

        # Clasificación por IA
        try:
            cat_name, sub_name = categorizer.categorize(uid, item['description'], item['amount'])
        except Exception as e:
            print(f"Error categorizing with AI: {e}")
            cat_name, sub_name = None, None

        c_id = cat_map.get(cat_name.lower()) if cat_name else None
        s_key = f"{c_id}_{sub_name.lower()}" if c_id and sub_name else None
        s_id = sub_map.get(s_key) if s_key else None

        # Normalize description to lowercase before saving so all records are consistent
        desc_saved = _norm_desc(item['description'])

        # Guardar en Firestore
        tx_ref.add({
            'date': item['date'],
            'description': desc_saved,
            'amount': item['amount'],
            'source': item['source'],
            'raw_text': item['raw_text'],
            'is_income': item['is_income'],
            'category_id': c_id,
            'subcategory_id': s_id,
            'created_at': datetime.now()
        })
        new_count += 1
        log(f"NUEVA: {dt_str} - {item['amount']} - {desc_saved[:30]}")

    # Guardar log de diagnóstico
    try:
        with open("import_debug.log", "w", encoding="utf-8") as f:
            f.write("\n".join(debug_log))
    except:
        pass

    return jsonify({'status': 'success', 'imported': new_count})

@main_bp.route('/api/transactions/<id>', methods=['DELETE'])
@token_required
def delete_transaction(uid, id):
    try:
        tx_ref = get_user_subcollection(uid, 'transactions')
        tx_ref.document(id).delete()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/transactions/link', methods=['POST'])
@token_required
def link_transactions(uid):
    data = request.json
    parent_id = data.get('parent_id')
    child_id = data.get('child_id')
    
    if not parent_id or not child_id:
        return jsonify({"status": "error", "message": "Missing IDs"}), 400
        
    try:
        tx_ref = get_user_subcollection(uid, 'transactions')
        tx_ref.document(child_id).update({
            'linked_transaction_id': parent_id
        })
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/transactions/unlink', methods=['POST'])
@token_required
def unlink_transaction(uid):
    data = request.json
    tx_id = data.get('id')
    
    if not tx_id:
        return jsonify({"status": "error", "message": "Missing ID"}), 400
        
    try:
        tx_ref = get_user_subcollection(uid, 'transactions')
        tx_ref.document(tx_id).update({
            'linked_transaction_id': None
        })
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/subscriptions', methods=['GET'])
@token_required
def get_subscriptions(uid):
    try:
        sub_ref = get_user_subcollection(uid, 'subscriptions')
        docs = sub_ref.get()
        res = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            res.append(d)
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/subscriptions', methods=['POST'])
@token_required
def save_subscription(uid):
    try:
        data = request.json
        sub_id = data.get('id')
        sub_ref = get_user_subcollection(uid, 'subscriptions')
        
        # Clean data for firestore
        raw_day = data.get('dayOfMonth')
        clean_data = {
            'name': data.get('name'),
            'amount': float(data.get('amount', 0)),
            'category': data.get('category', 'Otro'),
            'dayOfMonth': int(raw_day) if raw_day and str(raw_day).strip() else None,
            'frequency': data.get('frequency', 'mensual'),
            'timesPerMonth': int(data['timesPerMonth']) if data.get('timesPerMonth') else None,
            'isManual': True,
            'active': data.get('active', True),
            'updated_at': datetime.now()
        }
        
        if sub_id:
            sub_ref.document(sub_id).update(clean_data)
        else:
            clean_data['created_at'] = datetime.now()
            doc_ref = sub_ref.add(clean_data)
            sub_id = doc_ref[1].id
            
        return jsonify({"status": "success", "id": sub_id})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/subscriptions/<id>', methods=['PATCH'])
@token_required
def patch_subscription(uid, id):
    try:
        data = request.json or {}
        sub_ref = get_user_subcollection(uid, 'subscriptions')
        sub_ref.document(id).update(data)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@main_bp.route('/api/subscriptions/<id>', methods=['DELETE'])
@token_required
def delete_subscription(uid, id):
    try:
        sub_ref = get_user_subcollection(uid, 'subscriptions')
        sub_ref.document(id).delete()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
