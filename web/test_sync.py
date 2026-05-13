import sys
sys.path.append('c:/Users/alexd/Desktop/ALEJANDRO/PROYECTOS/TRACKEO INVERSIONES Y GASTOS/wealth_tracker/web')
from app import create_app
from app.firebase_utils import db_fs
from datetime import datetime, timezone

app = create_app()
with app.app_context():
    uid = 'CfYZBiQ9qLMaHxvLdn0lgOnC17y1'
    configs = db_fs.collection('users').document(uid).collection('asset_configs').where('subtype', '==', 'cash').get()
    for c in configs:
        doc = c.to_dict()
        if doc.get('type') == 'auto':
            print(f"--- {doc.get('name')} ---")
            print(f"Holdings: {doc.get('holdings')}")
            updated_at = doc.get('updated_at')
            max_processed = doc.get('max_processed_date')
            print(f"Updated_at: {updated_at}")
            print(f"Max processed: {max_processed}")
            
            ticker = doc.get('ticker')
            if ticker:
                txs = db_fs.collection('users').document(uid).collection('transactions').where('source', '==', ticker).get()
                parent_ids = {t.to_dict().get('linked_transaction_id') for t in txs if t.to_dict().get('linked_transaction_id')}
                tx_sum = 0
                for tx_doc in txs:
                    if tx_doc.id in parent_ids:
                        continue
                    tx = tx_doc.to_dict()
                    tx_date = tx.get('date')
                    if not updated_at or (tx_date and tx_date > updated_at):
                        tx_sum += tx.get('amount', 0)
                        print(f"  -> Adding tx: {tx.get('description')} ({tx.get('amount')}) at {tx_date}")
                print(f"Sum to add: {tx_sum}")
