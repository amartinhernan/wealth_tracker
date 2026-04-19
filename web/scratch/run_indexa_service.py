from app.services.indexa import fetch_indexa_data
import json

result = fetch_indexa_data()
print(json.dumps(result, indent=2))
