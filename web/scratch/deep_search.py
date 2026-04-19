import json

def find_key(obj, target_key, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_path = f"{path}.{k}" if path else k
            if k == target_key:
                print(f"FOUND {target_key} at {new_path}: {v if not isinstance(v, (dict, list)) else type(v)}")
            find_key(v, target_key, new_path)
    elif isinstance(obj, list):
        if "history" in path and len(obj) > 0:
            find_key(obj[0], target_key, f"{path}[0]")
        else:
            for i, x in enumerate(obj):
                find_key(x, target_key, f"{path}[{i}]")

with open('scratch/perf_9MFQHRUN.json', 'r') as f:
    data = json.load(f)

print("Searching for 'total_amount'...")
find_key(data, 'total_amount')
