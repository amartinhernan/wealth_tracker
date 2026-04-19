import pandas as pd
import io
from app.services.parsers import BankParser

# Mock Excel content with headers at row 5
data = [
    ["Metadata 1"],
    ["Metadata 2"],
    ["Metadata 3"],
    ["FECHA OPERACIÓN", "FECHA VALOR", "CONCEPTO", "IMPORTE EUR", "SALDO"],
    ["13/04/2026", "11/04/2026", "Café", "-1,50", "100,00"],
    ["13/04/2026", "11/04/2026", "Bizum", "10,00", "110,00"]
]
df = pd.DataFrame(data)
buffer = io.BytesIO()
df.to_excel(buffer, index=False, header=False)
content = buffer.getvalue()

header_idx = BankParser._find_header_row(content, ["CONCEPTO", "IMPORTE EUR"])
print(f"Header found at: {header_idx}")

txs = BankParser.parse_santander(content)
print(f"Parsed {len(txs)} transactions:")
for t in txs:
    print(t)
