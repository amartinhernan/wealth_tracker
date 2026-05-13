"""
Elimina snapshots de activos anteriores a una fecha de corte.
Uso (dry run, solo muestra):  python cleanup_history.py
Uso (borrado real):           python cleanup_history.py --confirm
"""
import sys
sys.path.append('c:/Users/alexd/Desktop/ALEJANDRO/PROYECTOS/TRACKEO INVERSIONES Y GASTOS/wealth_tracker/web')

from app import create_app
from app.firebase_utils import db_fs

UID        = 'CfYZBiQ9qLMaHxvLdn0lgOnC17y1'
CUTOFF     = '2026-04-01'   # se borran fechas ESTRICTAMENTE anteriores a esta
DRY_RUN    = '--confirm' not in sys.argv

app = create_app()
with app.app_context():
    assets_ref = db_fs.collection('users').document(UID).collection('assets')

    print(f"\n{'DRY RUN - no se borra nada' if DRY_RUN else 'MODO REAL - BORRANDO DATOS'}")
    print(f"Colección : users/{UID}/assets")
    print(f"Corte     : date < {CUTOFF}\n")

    old_docs = assets_ref.where('date', '<', CUTOFF).order_by('date').get()

    if not old_docs:
        print("No hay documentos anteriores a la fecha de corte. Nada que hacer.")
        sys.exit(0)

    # Agrupar por mes para mostrar resumen
    from collections import Counter
    months = Counter()
    for doc in old_docs:
        d = doc.to_dict().get('date', '')
        months[d[:7]] += 1

    print(f"Total documentos a eliminar: {len(old_docs)}")
    print("\nDesglose por mes:")
    for m in sorted(months):
        print(f"  {m}  =>  {months[m]} snapshots")

    if DRY_RUN:
        print("\nEjecuta con --confirm para borrar de verdad.")
        sys.exit(0)

    # ── BORRADO REAL ─────────────────────────────────────────
    print(f"\nEliminando {len(old_docs)} documentos...")
    batch = db_fs.batch()
    count = 0
    committed = 0
    for doc in old_docs:
        batch.delete(doc.reference)
        count += 1
        if count % 500 == 0:          # Firestore batch limit = 500 ops
            batch.commit()
            committed += count
            print(f"  ... {committed} eliminados")
            batch = db_fs.batch()
            count = 0

    if count > 0:
        batch.commit()
        committed += count

    print(f"\nListo. {committed} documentos eliminados.")
