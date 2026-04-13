from datetime import datetime
from app.models import db, Asset, AssetConfig
from .pricing import fetch_stock_price, fetch_crypto_price, fetch_crypto_price_batch, get_conversion_to_eur
from .indexa import fetch_indexa_data

def sync_managed_assets():
    """Recorre todos los activos configurados y los sincroniza según su SUBTYPE."""
    configs = AssetConfig.query.all()
    hoy = datetime.now().strftime('%Y-%m-%d')
    results = []
    
    # Reset FX cache
    from .pricing import _fx_cache
    _fx_cache.clear()

    # 0. Pre-fetch Crypto prices (Batch) para evitar Rate Limits
    crypto_prices = {}
    crypto_ids = []
    from .pricing import CRYPTO_MAPPING
    
    for c in configs:
        if c.subtype not in ['cash', 'indexa']:
            ticker_clean = (c.ticker or '').upper()
            if ticker_clean.endswith('-EUR') or ticker_clean.endswith('-USD'):
                ticker_clean = ticker_clean.split('-')[0]
            coin_id = CRYPTO_MAPPING.get(ticker_clean, (c.ticker or c.name).lower())
            if coin_id:
                crypto_ids.append(coin_id)
                
    if crypto_ids:
        print(f"INFO: Consultando {len(set(crypto_ids))} criptos en batch...")
        crypto_prices = fetch_crypto_price_batch(list(set(crypto_ids)))

    for conf in configs:
        actual_price_eur = 0.0
        actual_money = 0.0
        twr = 0.0
        mwr = 0.0
        invested_total = conf.invested_total
        
        # 1. CASH
        if conf.subtype == 'cash':
            actual_price_eur = 1.0
            actual_money = conf.holdings
            
        # 2. INDEXA
        elif conf.subtype == 'indexa':
            if conf.type == 'auto':
                idx_res = fetch_indexa_data()
                if idx_res.get('status') == 'success':
                    d = idx_res.get('data', {})
                    actual_money = d.get('actual_money', conf.holdings)
                    invested_total = d.get('total_invested', conf.invested_total)
                    twr = d.get('twr', 0.0)
                    mwr = d.get('mwr', 0.0)
                else:
                    actual_money = conf.holdings
            else:
                actual_money = conf.holdings
            actual_price_eur = 1.0
            
        # 3. MARKET (Stocks, ETFs, Crypto)
        else:
            if conf.ticker:
                # Intentar Yahoo primero para BTC o Tickers específicos
                stock_data = fetch_stock_price(conf.ticker)
                if stock_data:
                    raw_price = stock_data['price']
                    currency = stock_data['currency']
                    multiplier = get_conversion_to_eur(currency)
                    actual_price_eur = raw_price * multiplier
                    actual_money = actual_price_eur * conf.holdings
                else:
                    # Fallback a CoinGecko (usando el batch pre-cargado)
                    ticker_clean = conf.ticker.upper()
                    if ticker_clean.endswith('-EUR') or ticker_clean.endswith('-USD'):
                        ticker_clean = ticker_clean.split('-')[0]
                    coin_id = CRYPTO_MAPPING.get(ticker_clean, conf.ticker.lower())
                    actual_price_eur = crypto_prices.get(coin_id, 0.0)
                    actual_money = actual_price_eur * conf.holdings
            else:
                # Si no hay ticker, intentar por nombre en el batch de cripto
                coin_id = conf.name.lower()
                actual_price_eur = crypto_prices.get(coin_id, 1.0 if conf.subtype == 'manual' else 0.0)
                actual_money = actual_price_eur * conf.holdings

        # Persistencia
        profit_loss = actual_money - invested_total
        profit_loss_pct = (profit_loss / invested_total * 100) if invested_total > 0 else 0.0
        
        # Sobrescribir con datos de Indexa si aplica
        if conf.subtype == 'indexa' and conf.type == 'auto':
            profit_loss_pct = twr
            # Usamos avg_buy_price para guardar el MWR en este caso específico

        # 4. Cálculo final del beneficio
        profit_loss = actual_money - invested_total
        # profit_loss_pct ya está calculado arriba o viene de Indexa

        print(f"DEBUG: Syncing {conf.name}. Price: {actual_price_eur}, Value: {actual_money}")

        existing = Asset.query.filter_by(date=hoy, asset_name=conf.name).first()
        if existing:
            existing.actual_money = actual_money
            existing.actual_price = actual_price_eur
            existing.actual_holdings = conf.holdings
            existing.total_invest_money = invested_total
            existing.profit_loss = profit_loss
            existing.profit_loss_pct = twr if (conf.subtype == 'indexa' and conf.type == 'auto') else profit_loss_pct
            if conf.subtype == 'indexa' and conf.type == 'auto':
                existing.avg_buy_price = mwr
        else:
            new_record = Asset(
                date=hoy,
                asset_name=conf.name,
                portfolio=conf.portfolio,
                actual_price=actual_price_eur,
                avg_buy_price=mwr if (conf.subtype == 'indexa' and conf.type == 'auto') else (invested_total / conf.holdings if (conf.holdings and conf.holdings > 0) else 0.0),
                actual_holdings=conf.holdings,
                total_invest_money=invested_total,
                actual_money=actual_money,
                profit_loss=profit_loss,
                profit_loss_pct=twr if (conf.subtype == 'indexa' and conf.type == 'auto') else profit_loss_pct
            )
            db.session.add(new_record)
        
        results.append({"name": conf.name, "value": actual_money})

    db.session.commit()
    return {"status": "success", "synced": results}
