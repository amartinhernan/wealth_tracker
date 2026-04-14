from app import create_app
from app.models import Transaction, db
from datetime import datetime

app = create_app()
with app.app_context():
    april_txs = Transaction.query.filter(Transaction.date >= datetime(2026, 4, 1)).order_by(Transaction.date).all()
    print(f"Número de transacciones en Abril: {len(april_txs)}")
    print("-" * 50)
    for t in april_txs:
        print(f"ID: {t.id} | Fecha: {t.date} | {t.description[:40]:<40} | Importe: {t.amount:>8} | Origen: {t.source}")
