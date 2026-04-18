from app import create_app
from app.models import db, AssetConfig, Transaction
from datetime import datetime

app = create_app()
with app.app_context():
    e = AssetConfig.query.filter_by(ticker='EDENRED').first()
    if e:
        print(f"Edenred: holdings={e.holdings}, invested={e.invested_total}, updated_at={e.updated_at}")
    else:
        print("No se encontró Edenred config")
    
    # Ver transacciones de EDENRED
    txs = Transaction.query.filter_by(source='EDENRED').order_by(Transaction.date.desc()).limit(5).all()
    for t in txs:
        print(f"  TX: date={t.date}, amount={t.amount}, desc={t.description[:50]}")
    
    total = db.session.query(db.func.sum(Transaction.amount)).filter_by(source='EDENRED').scalar()
    print(f"Suma total TX EDENRED: {total}")
