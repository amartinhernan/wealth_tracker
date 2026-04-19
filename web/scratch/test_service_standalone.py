import sys
import os
import json

# Add the directory containing 'app' to sys.path
sys.path.append(os.getcwd())

# Import the function directly
from app.services.indexa import fetch_indexa_data

result = fetch_indexa_data()
print(json.dumps(result, indent=2))
