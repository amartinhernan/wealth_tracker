"""
Script para:
1. Restaurar invested_total en los asset_configs de efectivo
2. Rellenar (backfill) registros históricos faltantes para POL, Fantom, Cardano y Shiba del 10 de abril
"""
import os, sys
sys.path.append(os.getcwd())

from app.firebase_utils import get_user_subcollection

UID = "CfYZBiQ9qLMaHxvLdn0lgOnC17y1"

# ──────────────────────────────────────────────
# 1. Restaurar invested_total en configs de CASH
# ──────────────────────────────────────────────
# Los valores originales antes de que los pusiéramos a 0:
CASH_ORIGINALS = {
    "CUENTA DE AHORRO BANCO SANTANDER": 1269.17,
    "DEGIRO (Sin Invertir)": 55.51,
    "Edenred": 96.87,
    "PERSONAL WALLET": 1200.0,
    "REVOLUT": 5477.81,
}

configs_ref = get_user_subcollection(UID, 'asset_configs')
for name, original_val in CASH_ORIGINALS.items():
    doc = configs_ref.document(name).get()
    if doc.exists:
        current = doc.to_dict().get('invested_total', 0)
        if current == 0:
            print(f"  Restaurando {name}: 0 -> {original_val}")
            doc.reference.update({'invested_total': original_val})
        else:
            print(f"  {name} ya tiene invested_total={current}, no se toca")

# ──────────────────────────────────────────────
# 2. Restaurar total_invest_money en historial
# ──────────────────────────────────────────────
assets_ref = get_user_subcollection(UID, 'assets')
for name, original_val in CASH_ORIGINALS.items():
    docs = assets_ref.where('asset_name', '==', name).get()
    updated = 0
    for doc in docs:
        if doc.to_dict().get('total_invest_money', 0) == 0:
            doc.reference.update({'total_invest_money': original_val})
            updated += 1
    if updated:
        print(f"  Historial {name}: restaurados {updated} registros")

# ──────────────────────────────────────────────
# 3. Backfill: copiar registros del 12 al 10 de abril para los 4 cripto que faltan
# ──────────────────────────────────────────────
MISSING_CRYPTOS = ['Cardano', 'Fantom', 'POL (ex-MATIC)', 'Shiba Inu']
SOURCE_DATE = '2026-04-12'
TARGET_DATE = '2026-04-10'

for name in MISSING_CRYPTOS:
    # Verificar que no existe ya en el target
    target_id = f"{TARGET_DATE}_{name}"
    existing = assets_ref.document(target_id).get()
    if existing.exists:
        print(f"  {name} ya existe en {TARGET_DATE}, saltando")
        continue
    
    # Buscar datos del source date
    source_docs = assets_ref.where('asset_name', '==', name).where('date', '==', SOURCE_DATE).get()
    if not source_docs:
        print(f"  {name}: no hay datos en {SOURCE_DATE}, saltando")
        continue
    
    source_data = source_docs[0].to_dict()
    # Copiar con la nueva fecha
    backfill_data = dict(source_data)
    backfill_data['date'] = TARGET_DATE
    
    assets_ref.document(target_id).set(backfill_data)
    print(f"  Backfill: {name} copiado de {SOURCE_DATE} -> {TARGET_DATE} (inv={source_data.get('total_invest_money')})")

# ──────────────────────────────────────────────
# 4. Verificación
# ──────────────────────────────────────────────
print("\n--- VERIFICACIÓN ---")
for d in ['2026-04-10', '2026-04-12', '2026-04-15', '2026-04-18']:
    docs = assets_ref.where('date', '==', d).get()
    total_inv = sum(doc.to_dict().get('total_invest_money', 0) for doc in docs)
    total_val = sum(doc.to_dict().get('actual_money', 0) for doc in docs)
    n = len(docs)
    print(f"  {d}: {n} activos | Invertido: {total_inv:>12,.2f} | Valor: {total_val:>12,.2f}")
