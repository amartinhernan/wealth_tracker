import yfinance as yf

tickers = ['VUSD.L', 'VUSA.L', 'VUSA.AS', 'AAPL']

for ticker in tickers:
    try:
        t = yf.Ticker(ticker)
        # Probamos fast_info
        info = t.fast_info
        price = info['last_price']
        currency = info['currency']
        print(f"{ticker} -> Price: {price}, Currency: {currency}")
    except Exception as e:
        print(f"Error for {ticker}: {e}")

# Ver si podemos obtener tipos de cambio fácilmente
rates = ['EURUSD=X', 'EURGBP=X']
for r in rates:
    t = yf.Ticker(r)
    print(f"Rate {r}: {t.fast_info['last_price']}")
