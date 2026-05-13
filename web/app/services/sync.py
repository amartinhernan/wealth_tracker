from datetime import datetime, timezone
from app.firebase_utils import db_fs, get_user_subcollection
from .pricing import fetch_stock_price, fetch_crypto_price, fetch_crypto_price_batch, get_conversion_to_eur
from .indexa import fetch_indexa_data

BACKFILL_FROM = '2026-04-01'  # Only backfill from this date onwards — older data was deleted deliberately

def _backfill_indexa_month_ends(uid, asset_name, portfolio, daily_values, daily_invested):
    """
    Creates one Firestore snapshot per calendar month (last day with data) using
    Indexa's own daily history.  Skips months that already have a snapshot and
    skips any date before BACKFILL_FROM to avoid recreating deleted historical data.
    daily_values  : {YYYYMMDD: portfolio_value}
    daily_invested: {YYYYMMDD: cumulative_invested}
    """
    assets_col = get_user_subcollection(uid, 'assets')

    # Find the last trading day of each month
    month_last = {}
    for date_key in sorted(daily_values.keys()):
        if len(date_key) == 8 and date_key.isdigit():
            month_last[date_key[:6]] = date_key  # keeps overwriting → last day wins

    for ym, date_key in month_last.items():
        date_str = f"{date_key[:4]}-{date_key[4:6]}-{date_key[6:8]}"
        if date_str < BACKFILL_FROM:
            continue  # skip pre-April data that was intentionally deleted
        doc_id   = f"{date_str}_{asset_name}"

        if assets_col.document(doc_id).get().exists:
            continue  # already have this snapshot

        val  = float(daily_values.get(date_key) or 0.0)
        inv  = float(daily_invested.get(date_key) or 0.0)
        prof = val - inv
        prof_pct = (prof / inv * 100) if inv > 0 else 0.0

        assets_col.document(doc_id).set({
            'date': date_str,
            'asset_name': asset_name,
            'portfolio': portfolio,
            'actual_price': 1.0,
            'actual_holdings': val,
            'avg_buy_price': 0.0,
            'total_invest_money': inv,
            'actual_money': val,
            'profit_loss': prof,
            'profit_loss_pct': prof_pct
        })
        print(f"DEBUG: Backfilled Indexa snapshot {date_str} val={val:.2f} inv={inv:.2f}")


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

    # Cache for Indexa data to avoid redundant API calls within the same sync run
    idx_res_cache = None

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
            max_processed_date = None
            if c.get('type') == 'auto' and c.get('ticker'):
                tx_col = get_user_subcollection(uid, 'transactions')
                txs = tx_col.where('source', '==', c.get('ticker')).get()
                tx_sum = 0.0

                # PRIMARY cutoff: exact datetime when user last set a manual balance.
                # We compare tx.created_at (when the transaction was inventoried/imported)
                # against this timestamp — NOT the transaction date. This means:
                #   - A May-5 transaction imported on May 10 (after the anchor) → included ✓
                #   - A May-5 transaction imported on May 8 (before the anchor) → excluded ✓
                cutoff_dt = c.get('manual_balance_datetime')  # timezone-aware datetime or None
                # Ensure cutoff_dt is timezone-aware for safe comparison
                if cutoff_dt is not None and hasattr(cutoff_dt, 'tzinfo') and cutoff_dt.tzinfo is None:
                    cutoff_dt = cutoff_dt.replace(tzinfo=timezone.utc)

                # No coger transacciones que sean 'padres' (grupos)
                parent_ids = {doc.to_dict().get('linked_transaction_id') for doc in txs if doc.to_dict().get('linked_transaction_id')}

                for tx_doc in txs:
                    if tx_doc.id in parent_ids:
                        continue  # Ignorar grupos (padres), tomar solo transacciones individuales

                    tx = tx_doc.to_dict()
                    tx_created_at = tx.get('created_at')  # datetime: when inventoried

                    if tx_created_at is not None:
                        # Ensure tz-aware for comparison
                        if hasattr(tx_created_at, 'tzinfo') and tx_created_at.tzinfo is None:
                            tx_created_at = tx_created_at.replace(tzinfo=timezone.utc)
                        include = (cutoff_dt is None) or (tx_created_at > cutoff_dt)
                    else:
                        # Legacy fallback for transactions without created_at:
                        # compare using the transaction date string (old behavior).
                        raw_date = tx.get('date')
                        if isinstance(raw_date, str):
                            tx_date_str = raw_date[:10]
                        elif hasattr(raw_date, 'date'):
                            tx_date_str = raw_date.date().isoformat()
                        else:
                            tx_date_str = None
                        cutoff_date_str = c.get('manual_balance_date')
                        include = not cutoff_date_str or (tx_date_str and tx_date_str > cutoff_date_str)

                    if include:
                        tx_sum += tx.get('amount', 0)
                        if tx_created_at and (not max_processed_date or tx_created_at > max_processed_date):
                            max_processed_date = tx_created_at

                actual_money = holdings + tx_sum
                # After processing, store the sync time as the new cutoff.
                # Next sync will only include transactions inventoried AFTER this moment.
                c['new_cutoff_dt'] = datetime.now(timezone.utc)
            
        # 2. INDEXA
        elif subtype == 'indexa':
            if c.get('type') == 'auto':
                if idx_res_cache is None:
                    idx_res_cache = fetch_indexa_data()
                
                if idx_res_cache.get('status') == 'success':
                    d = idx_res_cache.get('data', {})
                    accounts_map = d.get('accounts', {})
                    
                    # 1. Match by account_number
                    acc_num = c.get('account_number')
                    a_data = None
                    
                    if acc_num and acc_num in accounts_map:
                        a_data = accounts_map[acc_num]
                        print(f"DEBUG: Matched Indexa asset {name} by account_number {acc_num}")
                    
                    # 2. Match by risk profile (e.g. "Perfil 8" -> risk 8)
                    if not a_data:
                        import re
                        match = re.search(r'PERFIL\s*(\d+)', name.upper())
                        if match:
                            target_risk = int(match.group(1))
                            for an, ad in accounts_map.items():
                                if ad.get('risk') == target_risk:
                                    a_data = ad
                                    print(f"DEBUG: Matched Indexa asset {name} by risk {target_risk}")
                                    break
                    
                    # 3. Fallback: if there's only one account in the API, use it
                    if not a_data and len(accounts_map) == 1:
                        a_data = list(accounts_map.values())[0]
                        print(f"DEBUG: Matched Indexa asset {name} as the only available account")

                    if a_data:
                        actual_money = a_data.get('actual_money', 0.0)
                        invested_total = a_data.get('total_invested', invested_total)
                        twr = a_data.get('twr', 0.0)
                        mwr = a_data.get('mwr', 0.0)
                        # Backfill month-end snapshots from Indexa daily history
                        _backfill_indexa_month_ends(
                            uid, name, c.get('portfolio'),
                            a_data.get('daily_values', {}),
                            a_data.get('daily_invested', {})
                        )
                    else:
                        # 4. Final resort: aggregate data (legacy behavior)
                        actual_money = d.get('actual_money', holdings)
                        invested_total = d.get('total_invested', invested_total)
                        twr = d.get('twr', 0.0)
                        mwr = d.get('mwr', 0.0)
                        print(f"DEBUG: Using Indexa aggregate for {name}")
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
        
        # Persist updated balance and advance the cutoff to the current sync time.
        # Next sync will only include transactions inventoried AFTER this moment.
        if subtype == 'cash' and c.get('type') == 'auto':
            try:
                configs_ref = get_user_subcollection(uid, 'asset_configs')
                sync_time = c.get('new_cutoff_dt') or datetime.now(timezone.utc)
                update_payload = {
                    'holdings': actual_money,
                    'updated_at': sync_time,
                    'manual_balance_datetime': sync_time,   # primary cutoff (with time)
                    'manual_balance_date': sync_time.strftime('%Y-%m-%d'),  # legacy fallback
                }
                print(f"DEBUG: Cash sync done for {name}: balance={actual_money:.2f}, cutoff advanced to {sync_time.isoformat()}")
                configs_ref.document(name).update(update_payload)
            except Exception as e:
                print(f"Error updating config for {name}: {e}")

        results.append({"name": name, "value": actual_money})

    return {"status": "success", "synced": results}
