from datetime import datetime
from flask import Blueprint, render_template, jsonify, request
from app.models import db, Asset, AssetConfig, Transaction, Category, Subcategory
from app.services.returns import calculate_returns
from app.services.indexa import sync_indexa
from app.services.sync import sync_managed_assets
from app.services.pricing import search_tickers, search_crypto

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

    # 3. Datos para la interfaz (Aseguramos que aparezcan activos configurados)
    config_names = {c.name: c for c in AssetConfig.query.all()}
    portfolios_grouped = {}
    hist_by_asset = {}
    
    for a in all_assets_ordered:
        if a.asset_name not in hist_by_asset:
            hist_by_asset[a.asset_name] = []
        hist_by_asset[a.asset_name].append((a.date, a.total_invest_money, a.actual_money))

    # Aseguramos que todos los activos en Config estén en current_assets para mostrarlos
    assets_to_show = list(current_assets)
    shown_names = {a.asset_name for a in assets_to_show}
    
    for c_name, c in config_names.items():
        if c_name not in shown_names:
            # Crear un objeto "dummy" para que aparezca en la tabla aunque no haya registros históricos
            dummy = Asset(asset_name=c_name, portfolio=c.portfolio, actual_money=0, total_invest_money=0, date=latest_date)
            assets_to_show.append(dummy)
            hist_by_asset[c_name] = [(latest_date, 0, 0)]

    for a in assets_to_show:
        # Mostrar si: está en el config activo O tiene valor/inversión (no es un fantasma viejo)
        if (a.asset_name in config_names) or (a.actual_money > 0 or a.total_invest_money > 0):
            port = a.portfolio.upper() if a.portfolio else "OTROS"
            if port not in portfolios_grouped:
                portfolios_grouped[port] = {"total_val": 0, "total_inv": 0, "assets": []}
            
            twr, mwr = calculate_returns(hist_by_asset[a.asset_name])
            
            # Reset returns for CASH or if specifically requested
            if port == "CASH":
                twr = 0.0
                mwr = 0.0
            elif "INDEXA" in a.asset_name.upper():
                twr = a.profit_loss_pct
                mwr = a.avg_buy_price
                
            portfolios_grouped[port]["total_val"] += a.actual_money
            portfolios_grouped[port]["total_inv"] += a.total_invest_money
            portfolios_grouped[port]["assets"].append({
                "name": a.asset_name, "invested": a.total_invest_money, "value": a.actual_money,
                "profit": a.profit_loss, "twr": twr, "mwr": mwr,
                "price": a.actual_price or 0.0, "holdings": a.actual_holdings or 0.0,
                "portfolio": port
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

from app.services.parsers import BankParser
from app.services.ai_categorizer import AICategorizer
from flask import request

@main_bp.route('/api/transactions', methods=['GET'])
def get_transactions():
    transactions = Transaction.query.order_by(Transaction.date.desc()).all()
    res = []
    for t in transactions:
        res.append({
            'id': t.id,
            'date': t.date.strftime('%Y-%m-%d') if t.date else None,
            'description': t.description,
            'amount': t.amount,
            'source': t.source,
            'category': t.category.name if t.category else 'Otros',
            'category_id': t.category_id,
            'subcategory': t.subcategory.name if t.subcategory else 'Otros',
            'subcategory_id': t.subcategory_id,
            'is_reviewed': t.is_reviewed,
            'is_income': t.is_income,
            'linked_transaction_id': t.linked_transaction_id
        })
    return jsonify(res)

@main_bp.route('/api/transactions/<int:id>', methods=['PATCH', 'PUT'])
def update_transaction(id):
    t = Transaction.query.get(id)
    if not t: return jsonify({'error': 'Not found'}), 404
    
    data = request.json
    if 'category_id' in data:
        t.category_id = data['category_id']
    if 'subcategory_id' in data:
        t.subcategory_id = data['subcategory_id']
    if 'is_reviewed' in data:
        t.is_reviewed = data['is_reviewed']
    if 'description' in data:
        t.description = data['description']
    if 'amount' in data:
        t.amount = data['amount']
        
    db.session.commit()
    return jsonify({'success': True})

@main_bp.route('/api/transactions/link', methods=['POST'])
def link_transaction():
    data = request.json
    child_id = data.get('child_id')
    parent_id = data.get('parent_id')
    
    child = Transaction.query.get(child_id)
    parent = Transaction.query.get(parent_id)
    
    if not child or not parent:
        return jsonify({'error': 'Transactions not found'}), 404
        
    child.linked_transaction_id = parent_id
    db.session.commit()
    return jsonify({'success': True})

@main_bp.route('/api/transactions/unlink', methods=['POST'])
def unlink_transaction():
    data = request.json
    id = data.get('id')
    t = Transaction.query.get(id)
    if not t: return jsonify({'error': 'Not found'}), 404
    
    t.linked_transaction_id = None
    db.session.commit()
    return jsonify({'success': True})

@main_bp.route('/api/transactions/<int:id>', methods=['DELETE'])
def delete_transaction(id):
    t = Transaction.query.get(id)
    if not t:
        return jsonify({'error': 'Transaction not found'}), 404
    
    # Si es una transacción padre, desvincular a los hijos
    children = Transaction.query.filter_by(linked_transaction_id=id).all()
    for child in children:
        child.linked_transaction_id = None
    
    db.session.delete(t)
    db.session.commit()
    return jsonify({'success': True})

@main_bp.route('/api/categories', methods=['GET'])
def get_categories():
    categories = Category.query.all()
    res = []
    for c in categories:
        res.append({
            'id': c.id,
            'name': c.name,
            'color': c.color,
            'subcategories': [{'id': s.id, 'name': s.name} for s in c.subcategories]
        })
    return jsonify(res)

@main_bp.route('/api/categories', methods=['POST'])
def save_category():
    data = request.json
    cat_id = data.get('id')
    if cat_id:
        cat = Category.query.get(cat_id)
        if not cat: return jsonify({'error': 'Not found'}), 404
        cat.name = data['name']
        cat.color = data.get('color', cat.color)
    else:
        cat = Category(name=data['name'], color=data.get('color', '#3B82F6'))
        db.session.add(cat)
    db.session.commit()
    return jsonify({'success': True, 'id': cat.id})

@main_bp.route('/api/categories/<int:id>', methods=['DELETE'])
def delete_category(id):
    cat = Category.query.get(id)
    if not cat: return jsonify({'error': 'Not found'}), 404
    db.session.delete(cat)
    db.session.commit()
    return jsonify({'success': True})

@main_bp.route('/api/subcategories', methods=['POST'])
def save_subcategory():
    data = request.json
    sub_id = data.get('id')
    if sub_id:
        sub = Subcategory.query.get(sub_id)
        if not sub: return jsonify({'error': 'Not found'}), 404
        sub.name = data['name']
    else:
        sub = Subcategory(name=data['name'], category_id=data['category_id'])
        db.session.add(sub)
    db.session.commit()
    return jsonify({'success': True, 'id': sub.id})

@main_bp.route('/api/subcategories/<int:id>', methods=['DELETE'])
def delete_subcategory(id):
    sub = Subcategory.query.get(id)
    if not sub: return jsonify({'error': 'Not found'}), 404
    db.session.delete(sub)
    db.session.commit()
    return jsonify({'success': True})

@main_bp.route('/api/transactions/import', methods=['POST'])
def import_transactions():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    source = request.form.get('source') # REVOLUT, SANTANDER, EDENRED
    
    if not source:
        return jsonify({'error': 'Source missing'}), 400
    
    try:
        content = file.read()
        parser = BankParser()
        
        if source == 'REVOLUT':
            data = parser.parse_revolut(content)
        elif source == 'SANTANDER':
            data = parser.parse_santander(content)
        elif source == 'EDENRED':
            data = parser.parse_edenred(content)
        else:
            return jsonify({'error': 'Invalid source'}), 400
    except Exception as e:
        import traceback
        print(f"Error importing {source}: {e}")
        print(traceback.format_exc())
        return jsonify({'error': f'Error procesando el archivo de {source}. Asegúrese de que el formato es correcto.'}), 500

    categorizer = AICategorizer()
    new_count = 0
    
    debug_log = []
    def log(msg):
        debug_log.append(f"{datetime.now().isoformat()} - {msg}")
        print(msg)

    # Optimizamos cargando las transacciones existentes en el rango de fechas de la importación
    if data:
        log(f"Iniciando importación de {len(data)} filas.")
        start_date = min(t['date'] for t in data)
        end_date = max(t['date'] for t in data)
        # Ampliamos el margen de búsqueda para cubrir el margen de 1 día de Santander/Edenred
        existing_txs = Transaction.query.filter(
            Transaction.date >= db.func.date(start_date, '-2 days'),
            Transaction.date <= db.func.date(end_date, '+2 days')
        ).all()
        log(f"Cargadas {len(existing_txs)} transacciones existentes para comparación.")
        
        # Mapa de firmas de transacciones existentes: (fecha, importe, desc, origen) -> lista de transacciones
        existing_map = {}
        for et in existing_txs:
            has_time = et.date.hour != 0 or et.date.minute != 0 or et.date.second != 0
            date_key = et.date if has_time else et.date.date()
            sig = (date_key, et.amount, et.description, et.source)
            if sig not in existing_map:
                existing_map[sig] = []
            existing_map[sig].append(et)
            
        # También mapeamos por raw_text (todas las columnas del banco)
        existing_raw_map = {}
        for et in existing_txs:
            if et.raw_text not in existing_raw_map:
                existing_raw_map[et.raw_text] = []
            existing_raw_map[et.raw_text].append(et)

    # Mapeos de categorías para eficiencia
    cat_map = {c.name.lower(): c.id for c in Category.query.all()}
    sub_map = {}
    for c in Category.query.all():
        for s in c.subcategories:
            sub_map[f"{c.id}_{s.name.lower()}"] = s.id

    for item in data:
        has_time = item['date'].hour != 0 or item['date'].minute != 0 or item['date'].second != 0
        date_key = item['date'] if has_time else item['date'].date()
        sig = (date_key, item['amount'], item['description'], item['source'])
        
        match = None
        
        # 1. Intentar coincidir por Firma Exacta
        if sig in existing_map and existing_map[sig]:
            match = existing_map[sig].pop(0)
            log(f"SALTADA (Firma): {item['date']} - {item['amount']} - {item['description'][:30]}...")
        
        # 2. Intentar coincidir por Raw Text (IGUALDAD ESTRICTA DE TODAS LAS COLUMNAS)
        if not match and item['raw_text'] in existing_raw_map and existing_raw_map[item['raw_text']]:
            match = existing_raw_map[item['raw_text']].pop(0)
            log(f"SALTADA (Raw): {item['date']} - {item['amount']} - {item['description'][:30]}...")

        # 3. Margen de 1 día para bancos sin hora
        if not match and not has_time:
            from datetime import timedelta
            for delta in [-1, 1]:
                alt_date = date_key + timedelta(days=delta)
                alt_sig = (alt_date, item['amount'], item['description'], item['source'])
                if alt_sig in existing_map and existing_map[alt_sig]:
                    match = existing_map[alt_sig].pop(0)
                    log(f"SALTADA (Margen 1d): {item['date']} -> {alt_date} - {item['amount']}...")
                    break

        if not match:
            # IA Categorization
            cat_name, sub_name = categorizer.categorize(item['description'], item['amount'])
            
            c_id = cat_map.get(cat_name.lower()) if cat_name else None
            s_id = sub_map.get(f"{c_id}_{sub_name.lower()}") if c_id and sub_name else None

            t = Transaction(
                date=item['date'],
                description=item['description'],
                amount=item['amount'],
                source=item['source'],
                raw_text=item['raw_text'],
                is_income=item['is_income'],
                category_id=c_id,
                subcategory_id=s_id
            )
            db.session.add(t)
            new_count += 1
            log(f"NUEVA: {item['date']} - {item['amount']} - {item['description'][:30]}...")
            
    db.session.commit()
    
    # Guardar log en disco para diagnóstico
    with open("import_debug.log", "w", encoding="utf-8") as f:
        f.write("\n".join(debug_log))
    
    # Lógica de Bizums (Post-import) - Desactivada por petición del usuario para que solo clasifique
    # match_bizums()
    
    return jsonify({'imported': new_count})

def match_bizums():
    # Buscar ingresos que contengan "Bizum" y no estén vinculados
    bizums = Transaction.query.filter(
        Transaction.is_income == True,
        Transaction.description.contains('Bizum'),
        Transaction.linked_transaction_id == None
    ).all()
    
    for bizum in bizums:
        # Buscar un gasto (negativo) con el mismo importe aproximado (absoluto) en EDENRED
        # O en REVOLUT/SANTANDER que no esté ya cubierto.
        # Por ahora heurística simple: mismo importe absoluto, misma semana
        possible_match = Transaction.query.filter(
            Transaction.is_income == False,
            db.func.abs(Transaction.amount) >= db.func.abs(bizum.amount) * 0.9, # Margen
            db.func.abs(Transaction.amount) <= db.func.abs(bizum.amount) * 1.1,
            Transaction.linked_transaction_id == None
        ).order_by(db.func.abs(db.func.julianday(Transaction.date) - db.func.julianday(bizum.date))).first()
        
        if possible_match:
            bizum.linked_transaction_id = possible_match.id
            db.session.commit()

@main_bp.route('/api/sync/indexa', methods=['POST'])
def trigger_sync_indexa():
    result = sync_indexa()
    return jsonify(result)

# --- Gestión de Configuración de Activos ---

@main_bp.route('/api/configs', methods=['GET'])
def get_configs():
    configs = AssetConfig.query.all()
    return jsonify([{
        'id': c.id,
        'name': c.name,
        'portfolio': c.portfolio,
        'subtype': c.subtype,
        'type': c.type,
        'ticker': c.ticker,
        'holdings': c.holdings,
        'invested_total': c.invested_total
    } for c in configs])

@main_bp.route('/api/configs', methods=['POST'])
def save_config():
    data = request.json
    conf_id = data.get('id')
    
    if conf_id:
        conf = AssetConfig.query.get(conf_id)
    else:
        conf = AssetConfig(name=data['name'])
        db.session.add(conf)
    
    conf.name = data['name']
    conf.portfolio = data['portfolio']
    conf.subtype = data.get('subtype', 'market')
    conf.type = data['type']
    conf.ticker = data.get('ticker')
    conf.holdings = float(data.get('holdings', 0))
    conf.invested_total = float(data.get('invested_total', 0))
    conf.updated_at = datetime.utcnow()  # Marcar cuándo fue la última actualización manual
    
    db.session.commit()
    # Sincronizamos inmediatamente para que los cambios se vean en el dashboard
    sync_managed_assets()
    return jsonify({"status": "success"})

@main_bp.route('/api/configs/<int:id>', methods=['DELETE'])
def delete_config(id):
    conf = AssetConfig.query.get(id)
    if conf:
        name = conf.name
        db.session.delete(conf)
        db.session.commit()
        
        # Eliminar también la entrada de hoy en Asset si existe para que desaparezca del dashboard
        hoy = datetime.now().strftime('%Y-%m-%d')
        Asset.query.filter_by(date=hoy, asset_name=name).delete()
        db.session.commit()
        
        sync_managed_assets()
    return jsonify({"status": "success"})

@main_bp.route('/api/sync/all', methods=['POST'])
def trigger_sync_all():
    # sync_managed_assets ya se encarga de llamar a sync_indexa si hay alguno configurado como 'indexa'
    managed_res = sync_managed_assets()
    return jsonify({
        "status": "success",
        "managed": managed_res
    })

@main_bp.route('/api/portfolio/analysis', methods=['POST'])
def portfolio_analysis():
    import os, json
    try:
        from groq import Groq
    except ImportError:
        return jsonify({"summary": "Error: Librería Groq no instalada.", "items": []}), 500

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return jsonify({"summary": "Error: GROQ_API_KEY no configurada en las variables de entorno.", "items": []}), 500

    data = request.json or {}
    portfolio_summary = data.get('portfolio', '')

    prompt = f"""
    Eres un asesor financiero experto. Analiza el portfolio del usuario y genera exactamente 3 bullets de insights concisos y accionables en español. 
    Responde ÚNICAMENTE con un JSON en este formato exacto: {{"summary":"frase corta de 1 línea sobre el estado del portfolio","items":[{{"icon":"emoji","text":"insight accionable"}}]}} - 3 items exactamente. Sé específico con los números.
    
    Portfolio:
    {portfolio_summary}
    """

    try:
        client = Groq(api_key=api_key)
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "Eres un asistente financiero que sólo responde en formato JSON sin formato de bloques de código markdown."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            model="llama-3.3-70b-versatile",
            response_format={"type": "json_object"}
        )
        # Parse output safely
        raw_output = chat_completion.choices[0].message.content
        res = json.loads(raw_output)
        return jsonify(res)
    except Exception as e:
        print(f"Error calling Groq API: {e}")
        return jsonify({"summary": f"No se pudo completar el análisis IA: {str(e)}", "items": []}), 500

@main_bp.route('/api/search')
def search():
    q = request.args.get('q', '')
    portfolio = request.args.get('portfolio', '') # Contexto de categoría
    if not q: return jsonify([])
    
    if portfolio == 'CRYPTO':
        return jsonify(search_crypto(q))
    
    # Búsqueda híbrida si no hay contexto claro: Yahoo + CoinGecko
    yahoo_results = search_tickers(q)
    
    # Si parece que busca cripto, añadimos resultados de CoinGecko
    return jsonify(yahoo_results)
