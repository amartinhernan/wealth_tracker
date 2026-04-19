import json

with open('scratch/perf_9MFQHRUN.json', 'r') as f:
    data = json.load(f)

print(f"Top level keys: {list(data.keys())}")
if 'return' in data:
    print(f"'return' keys: {list(data['return'].keys())}")
    print(f"'return' values: {data['return']}")
else:
    print("'return' NOT FOUND at top level")
