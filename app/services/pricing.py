import yfinance as yf
import requests
import json

# Cache simple para tipos de cambio (duración de la sesión de sync)
_fx_cache = {}

def get_conversion_to_eur(currency):
    """Obtiene el multiplicador para convertir de 'currency' a EUR."""
    if not currency or currency.upper() in ['EUR', 'EUR', '€']:
        return 1.0
    
    currency = currency.upper()
    if currency in _fx_cache:
        return _fx_cache[currency]
    
    # Intentamos primero con el par directo inverso (USD/EUR)
    pair = f"{currency}EUR=X"
    try:
        t = yf.Ticker(pair)
        rate = t.fast_info.get('last_price')
        if rate:
            _fx_cache[currency] = float(rate)
            return float(rate)
    except:
        pass

    # Si falla, intentamos el par directo (EUR/USD) y lo invertimos
    pair_inv = f"EUR{currency}=X"
    try:
        t = yf.Ticker(pair_inv)
        rate = t.fast_info.get('last_price')
        if rate:
            multiplier = 1.0 / float(rate)
            _fx_cache[currency] = multiplier
            return multiplier
    except:
        pass
        
    # Fallback manual aproximado por si falla la API
    fallbacks = {'USD': 0.92, 'GBP': 1.15, 'CHF': 1.04}
    return fallbacks.get(currency, 1.0)

def fetch_stock_price(ticker):
    """
    Obtiene el precio actual y la moneda de un ticker.
    Retorna: {'price': float, 'currency': str}
    """
    try:
        t = yf.Ticker(ticker)
        # Intentamos fast_info primero
        info = t.fast_info
        last_price = info.get('last_price')
        currency = info.get('currency')
        
        # Si falló, intentamos history (más lento pero fiable)
        if not last_price:
            hist = t.history(period="1d")
            if not hist.empty:
                last_price = float(hist['Close'].iloc[-1])
            
        # Moneda como último recurso desde info
        if not currency:
            currency = t.info.get('currency', 'EUR')

        if last_price:
            if currency == 'GBp': # Peniques londinenses
                return {'price': float(last_price) / 100.0, 'currency': 'GBP'}
            return {'price': float(last_price), 'currency': currency}
            
        return None
    except Exception as e:
        print(f"Error fetching stock price for {ticker}: {e}")
        return None

CRYPTO_MAPPING = {
    'POL': 'polygon-ecosystem-token',
    'FTM': 'fantom',
    'SHIB': 'shiba-inu',
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'BNB': 'binancecoin',
    'SOL': 'solana',
    'ADA': 'cardano',
    'XRP': 'ripple',
    'DOT': 'polkadot',
    'DOGE': 'dogecoin',
    'LINK': 'chainlink',
    'MATIC': 'polygon-ecosystem-token',
    'AVAX': 'avalanche-2',
}

def fetch_crypto_price(ticker_or_id):
    """
    Obtiene el precio actual de una cripto en CoinGecko.
    Acepta un ticker común (ej: BTC, POL) o un ID de CoinGecko (ej: bitcoin).
    """
    # Intentar mapear ticker a ID
    # Normalizar ticker: quitar -EUR o -USD si viene de Yahoo
    ticker_clean = ticker_or_id.upper()
    if ticker_clean.endswith('-EUR') or ticker_clean.endswith('-USD'):
        ticker_clean = ticker_clean.split('-')[0]
        
    coin_id = CRYPTO_MAPPING.get(ticker_clean, ticker_or_id.lower())
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x44) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
    }
    
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=eur"
        response = requests.get(url, headers=headers, timeout=15)
        
        if response.status_code == 429:
            print(f"AVISO: Rate limit en CoinGecko para {coin_id}")
            return None
            
        data = response.json()
        if coin_id in data and 'eur' in data[coin_id]:
            return float(data[coin_id]['eur'])
        
        return None
    except Exception as e:
        print(f"Error fetching crypto price for {ticker_or_id} (ID: {coin_id}): {e}")
        return None

def fetch_crypto_price_batch(coin_ids):
    """Obtiene precios de múltiples IDs en una sola llamada."""
    if not coin_ids: return {}
    
    ids_param = ",".join(coin_ids)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x44) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids_param}&vs_currencies=eur"
        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            return {cid: float(info['eur']) for cid, info in data.items() if 'eur' in info}
        return {}
    except Exception as e:
        print(f"Error in crypto batch fetch: {e}")
        return {}

def search_tickers(query):
    """Busca tickers en la API no oficial de Yahoo Finance."""
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={query}"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        
        results = []
        for quote in data.get('quotes', []):
            results.append({
                'symbol': quote.get('symbol'),
                'name': quote.get('shortname') or quote.get('longname'),
                'type': quote.get('quoteType'),
                'exch': quote.get('exchDisp')
            })
        return results
    except Exception as e:
        print(f"Error searching tickers for {query}: {e}")
        return []

def search_crypto(query):
    """Busca activos en CoinGecko."""
    try:
        url = f"https://api.coingecko.com/api/v3/search?query={query}"
        response = requests.get(url, timeout=10)
        data = response.json()
        
        results = []
        for coin in data.get('coins', []):
            results.append({
                'symbol': coin.get('id'), # Usamos el ID como símbolo para sincronización precisa
                'name': coin.get('name'),
                'display_symbol': coin.get('symbol').upper(),
                'type': 'CRYPTO',
                'exch': f"Rank #{coin.get('market_cap_rank') or '?'}"
            })
        return results
    except Exception as e:
        print(f"Error searching crypto for {query}: {e}")
        return []
