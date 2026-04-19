from datetime import datetime
from app.firebase_utils import db_fs, get_user_subcollection
from .pricing import fetch_stock_price, fetch_crypto_price, fetch_crypto_price_batch, get_conversion_to_eur
from .indexa import fetch_indexa_data

def sync_managed_assets(uid):
    """Sincroniza activos desde Firestore para un usuario específico."""
    configs_ref = get_user_subcollection(uid, 'asset_configs')
    configs = configs_ref.get()
    
    hoy = datetime.now().strftime('%Y-%m-%d')
    results = []
    
    # Reset FX cache
    from .pricing import _fx_cache
    _fx_cache.clear()

    # 0. Pre-fetch Crypto prices (Batch)
    crypto_prices = {}
    crypto_ids = []
    from .pricing import CRYPTO_MAPPING
    
    all_configs = [c.to_dict() for c in configs]
    
    for c in all_configs:
        if c.get('subtype') not in ['cash', 'indexa']:
            ticker_clean = (c.get('ticker') or '').upper()
            if ticker_clean.endswith('-EUR') or ticker_clean.endswith('-USD'):
                ticker_clean = ticker_clean.split('-')[0]
            coin_id = CRYPTO_MAPPING.get(ticker_clean, (c.get('ticker') or c.get('name', '')).lower())
            if coin_id:
                crypto_ids.append(coin_id)
                
    if crypto_ids:
        crypto_prices = fetch_crypto_price_batch(list(set(crypto_ids)))

    for c in all_configs:
        name = c.get('name')
        # Para otros tipos de assets, el capital invertido es el baseline manual configurado
        invested_total = float(c.get('invested_total', 0.0))
        subtype = c.get('subtype')
        holdings = float(c.get('holdings', 0))
        actual_price_eur = 0.0
        actual_money = 0.0
        twr = 0.0
        mwr = 0.0
        
        # 1. CASH
        if subtype == 'cash':
            actual_price_eur = 1.0
            actual_money = holdings
            if c.get('type') == 'auto' and c.get('ticker'):
                tx_col = get_user_subcollection(uid, 'transactions')
                txs = tx_col.where('source', '==', c.get('ticker')).get()
                tx_sum = 0.0
                updated_at = c.get('updated_at')
                # updated_at puede ser un datetime o un timestamp de Firestore
                for tx_doc in txs:
                    tx = tx_doc.to_dict()
                    if not updated_at or (tx.get('date') and tx['date'] > updated_at):
                        tx_sum += tx.get('amount', 0)
                actual_money = holdings + tx_sum
            
        # 2. INDEXA
        elif subtype == 'indexa':
            if c.get('type') == 'auto':
                idx_res = fetch_indexa_data()
                if idx_res.get('status') == 'success':
                    d = idx_res.get('data', {})
                    actual_money = d.get('actual_money', holdings)
                    invested_total = d.get('total_invested', invested_total)
                    twr = d.get('twr', 0.0)
                    mwr = d.get('mwr', 0.0)
                else:
                    actual_money = holdings
            else:
                actual_money = holdings
            actual_price_eur = 1.0
            
        # 3. MARKET
        else:
            ticker = c.get('ticker')
            if ticker:
                stock_data = fetch_stock_price(ticker)
                if stock_data:
                    raw_price = stock_data['price']
                    multiplier = get_conversion_to_eur(stock_data['currency'])
                    actual_price_eur = raw_price * multiplier
                    actual_money = actual_price_eur * holdings
                else:
                    ticker_clean = ticker.upper()
                    if ticker_clean.endswith('-EUR') or ticker_clean.endswith('-USD'):
                        ticker_clean = ticker_clean.split('-')[0]
                    coin_id = CRYPTO_MAPPING.get(ticker_clean, ticker.lower())
                    actual_price_eur = crypto_prices.get(coin_id, 0.0)
                    actual_money = actual_price_eur * holdings
            else:
                coin_id = (name or '').lower()
                actual_price_eur = crypto_prices.get(coin_id, 1.0 if subtype == 'manual' else 0.0)
                actual_money = actual_price_eur * holdings

        # 4. Persistencia en Firestore
        profit_loss = actual_money - invested_total
        profit_loss_pct = (profit_loss / invested_total * 100) if invested_total > 0 else 0.0
        
        if subtype == 'indexa' and c.get('type') == 'auto':
            profit_loss_pct = twr

        print(f"DEBUG: Syncing {name}. Price: {actual_price_eur}, Value: {actual_money}")

        asset_id = f"{hoy}_{name}"
        asset_ref = get_user_subcollection(uid, 'assets').document(asset_id)
        
        asset_data = {
            'date': hoy,
            'asset_name': name,
            'portfolio': c.get('portfolio'),
            'actual_price': actual_price_eur,
            'avg_buy_price': mwr if (subtype == 'indexa' and c.get('type') == 'auto') else (invested_total / holdings if (holdings > 0) else 0.0),
            'actual_holdings': (actual_money / actual_price_eur) if actual_price_eur > 0 else holdings,
            'total_invest_money': invested_total,
            'actual_money': actual_money,
            'profit_loss': profit_loss,
            'profit_loss_pct': profit_loss_pct
        }
        asset_ref.set(asset_data)
        results.append({"name": name, "value": actual_money})

    return {"status": "success", "synced": results}
