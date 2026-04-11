from datetime import datetime

def calculate_returns(history):
    """Calcula TWR y MWR Cumulativo"""
    records = []
    for d_str, inv, val in history:
        try:
            records.append({'date': datetime.strptime(d_str, "%Y-%m-%d"), 'invested': inv, 'value': val})
        except:
            pass
    if not records:
        return 0, 0
    
    rec0 = records[0]
    twr_multiplier = (rec0['value'] / rec0['invested']) if rec0['invested'] > 0 else 1.0
    t0, tf = rec0['date'], records[-1]['date']
    total_days = (tf - t0).days if (tf - t0).days > 0 else 1
    
    V0 = rec0['invested']
    weighted_cf = V0 * 1.0
    prev_inv, prev_val = V0, rec0['value']
    
    for rec in records[1:]:
        cf = rec['invested'] - prev_inv
        if cf != 0:
            weight = (tf - rec['date']).days / total_days
            weighted_cf += cf * weight
            
        base = prev_val + cf
        if base > 0:
            period_return = (rec['value'] - base) / base
        elif base == 0 and prev_val == 0 and cf > 0:
            period_return = (rec['value'] - cf) / cf if cf else 0
        else:
            period_return = 0
            
        twr_multiplier *= (1 + period_return)
        prev_inv, prev_val = rec['invested'], rec['value']
        
    twr = (twr_multiplier - 1) * 100
    net_profit = records[-1]['value'] - records[-1]['invested']
    mwr = (net_profit / weighted_cf) * 100 if weighted_cf != 0 else 0
    return twr, mwr
