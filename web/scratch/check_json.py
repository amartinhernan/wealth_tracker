import json

with open('scratch/perf_9MFQHRUN.json', 'r') as f:
    data = json.load(f)

print(f"Top level keys: {list(data.keys())}")
if 'return' in data:
    print(f"'return' found: {data['return']}")
else:
    print("'return' not found")

if 'total_amount' in data:
    print(f"'total_amount' found: {data['total_amount']}")
else:
    print("'total_amount' not found")

# Look at the first element of history to see what it has
if 'history' in data and len(data['history']) > 0:
    print(f"First history entry keys: {list(data['history'][0].keys())}")
    print(f"Last history entry keys: {list(data['history'][-1].keys())}")
    print(f"Last history total_amount: {data['history'][0].get('total_amount')}") # Wait, history is usually reverse chronological or chronological?
