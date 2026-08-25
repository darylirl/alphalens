"""60-day e2e verification run.

Strategy (same shape as the smoke-test spec, scaled to 60 days):
  entry: rolling 24h sum of BTC cohort net_flow_usd crosses above 0 -> long
  exit:  max holding time 6h
  frictions: delay >= 60s, slippage 5 bps adverse each side, taker 0.045% each side
  sizing: fixed 1000 USD notional per trade

Execution model (honest, 1h granularity): the rolling sum through bucket H is
known when bucket H closes at H+1h; adding the 60s delay, the first tradable
hourly bar boundary is H+2h. Entries and exits fill at hourly bar OPENs, so
the realized delay is 60s..1h — at or above the 60s floor, declared in
data_coverage.granularity_mix.

Invariant: missing data is never zero. The rolling 24h sum is None if any
bucket in the lookback is uncovered; the rule never fires on or across None.
"""
import json, csv, hashlib, datetime as dt

SCRATCH = '/tmp/claude-0/-home-user-alphalens/01b58ebf-0f07-59bc-b777-30008a3379ab/scratchpad'
UTC = dt.timezone.utc

def parse_ts(s):
    return dt.datetime.strptime(s.replace('+00', '+0000'), '%Y-%m-%d %H:%M:%S%z')

series = json.load(open(f'{SCRATCH}/series_p1.json')) + json.load(open(f'{SCRATCH}/series_p2.json'))
series = [{'bucket': parse_ts(r['bucket']), 'covered': r['covered'], 'net_flow': r['net_flow']} for r in series]
series.sort(key=lambda r: r['bucket'])
assert len(series) == 1440, len(series)

candles = json.load(open(f'{SCRATCH}/btc_1h.json'))
opens = {int(c['t']) // 1000: float(c['o']) for c in candles}  # bar-open epoch s -> open price

def open_at(t: dt.datetime):
    return opens.get(int(t.timestamp()))

# Rolling 24h sum of net_flow, None if any bucket in the lookback is uncovered.
LOOKBACK = 24
rolling = []  # (bucket, sum_or_None)
for i in range(len(series)):
    if i < LOOKBACK - 1:
        rolling.append((series[i]['bucket'], None))
        continue
    window = series[i - LOOKBACK + 1: i + 1]
    if any(not w['covered'] or w['net_flow'] is None for w in window):
        rolling.append((series[i]['bucket'], None))
    else:
        rolling.append((series[i]['bucket'], sum(w['net_flow'] for w in window)))

DELAY_S = 60
SLIPPAGE_BPS = 5
TAKER_PCT = 0.045
SIZE_USD = 1000.0
MAX_HOLD_H = 6

trades = []
in_pos_until = None
prev = None
for bucket, s in rolling:
    fired = prev is not None and s is not None and prev <= 0 and s > 0
    prev = s
    if not fired:
        continue
    # signal known at bucket close (bucket+1h); +60s delay -> first bar open at bucket+2h
    entry_t = bucket + dt.timedelta(hours=2)
    if in_pos_until is not None and entry_t < in_pos_until:
        continue  # single position at a time
    exit_t = entry_t + dt.timedelta(hours=MAX_HOLD_H)
    ep, xp = open_at(entry_t), open_at(exit_t)
    if ep is None or xp is None:
        continue  # no real price bar -> no trade (never synthesize)
    entry_fill = ep * (1 + SLIPPAGE_BPS / 10_000)   # adverse for a long entry
    exit_fill = xp * (1 - SLIPPAGE_BPS / 10_000)    # adverse for a long exit
    qty = SIZE_USD / entry_fill
    gross = qty * (exit_fill - entry_fill)
    fees = (qty * entry_fill + qty * exit_fill) * (TAKER_PCT / 100)
    trades.append({
        'signal_bucket': bucket, 'entry_time': entry_t, 'exit_time': exit_t,
        'side': 'long', 'entry_price': entry_fill, 'exit_price': exit_fill,
        'qty': qty, 'gross_pnl_usd': gross, 'fees_usd': fees,
        'net_pnl_usd': gross - fees, 'hold_s': MAX_HOLD_H * 3600,
    })
    in_pos_until = exit_t

# Metrics
net = sum(t['net_pnl_usd'] for t in trades)
gross = sum(t['gross_pnl_usd'] for t in trades)
fees = sum(t['fees_usd'] for t in trades)
wins = [t for t in trades if t['net_pnl_usd'] > 0]
losses = [t for t in trades if t['net_pnl_usd'] < 0]
gross_win = sum(t['net_pnl_usd'] for t in wins)
gross_loss = -sum(t['net_pnl_usd'] for t in losses)
equity, peak, mdd = 0.0, 0.0, 0.0
for t in trades:
    equity += t['net_pnl_usd']
    peak = max(peak, equity)
    mdd = max(mdd, peak - equity)
monthly = {}
for t in trades:
    monthly.setdefault(t['exit_time'].strftime('%Y-%m'), 0.0)
    monthly[t['exit_time'].strftime('%Y-%m')] += t['net_pnl_usd']

metrics = {
    'net_pnl_usd': round(net, 2),
    'gross_pnl_usd': round(gross, 2),
    'fees_usd': round(fees, 2),
    'win_rate': round(len(wins) / len(trades), 4) if trades else 0,
    'profit_factor': round(gross_win / gross_loss, 4) if gross_loss > 0 else None,
    'max_drawdown_usd': round(mdd, 2),
    'max_drawdown_pct': round(mdd / SIZE_USD * 100, 2),  # vs fixed 1000 USD position size
    'trade_count': len(trades),
    'avg_hold_s': int(sum(t['hold_s'] for t in trades) / len(trades)) if trades else 0,
    'monthly': [{'month': m, 'net_pnl_usd': round(v, 2)} for m, v in sorted(monthly.items())],
}

spec = {
    'spec_version': '1',
    'hypothesis_text': 'When the 24h rolling cohort net flow into BTC crosses above zero, going long for 6h is profitable after realistic frictions.',
    'universe': {'coins': ['BTC'], 'cohort_filters': None},
    'entry': {'type': 'cross_above', 'series': 'cohort.net_flow_usd', 'threshold': 0, 'window': '24h', 'side': 'long'},
    'exit': {'type': 'max_holding_time_h', 'hours': 6},
    'window': {'start': '2026-06-16T00:00:00.000Z', 'end': '2026-08-15T00:00:00.000Z'},
    'frictions': {'delay_s': 60, 'slippage_bps': 5, 'taker_fee_pct': 0.045},
    'sizing': {'type': 'fixed_usd', 'usd': 1000},
    'kill_criteria': [
        {'id': 'unprofitable', 'metric': 'net_pnl_usd', 'op': 'lte', 'value': 0},
        {'id': 'too_few_trades', 'metric': 'trade_count', 'op': 'lt', 'value': 10},
    ],
}
spec_hash = hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

criteria = [
    {'id': 'unprofitable', 'pass': metrics['net_pnl_usd'] > 0,
     'detail': f"net_pnl_usd={metrics['net_pnl_usd']} must be > 0"},
    {'id': 'too_few_trades', 'pass': metrics['trade_count'] >= 10,
     'detail': f"trade_count={metrics['trade_count']} must be >= 10"},
]
verdict = {'overall': 'pass' if all(c['pass'] for c in criteria) else 'killed', 'criteria': criteria}

covered_hours = sum(1 for r in series if r['covered'])
data_coverage = {
    'window_requested': {'start': spec['window']['start'], 'end': spec['window']['end']},
    'window_served': {'start': series[0]['bucket'].isoformat(), 'end': (series[-1]['bucket'] + dt.timedelta(hours=1)).isoformat()},
    'granularity_mix': {
        'signal_series': '1h cohort_flow_series buckets (1440/1440 covered)',
        'execution_prices': '1h Hyperliquid candle opens; realized delay 60s..1h (>= 60s floor)',
    },
    'source_mix': {
        'signal_series': 'supabase.cohort_flow_series (captured fills, capture_gaps pairs excluded)',
        'execution_prices': 'hyperliquid.api candleSnapshot BTC 1h (1453 bars, gap-free)',
    },
    'excluded_pairs': [],
    'covered_hours': covered_hours,
    'total_hours': len(series),
}

with open(f'{SCRATCH}/trades_60d.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['signal_bucket', 'entry_time', 'exit_time', 'side', 'entry_price', 'exit_price', 'qty', 'gross_pnl_usd', 'fees_usd', 'net_pnl_usd', 'hold_s'])
    for t in trades:
        w.writerow([t['signal_bucket'].isoformat(), t['entry_time'].isoformat(), t['exit_time'].isoformat(),
                    t['side'], f"{t['entry_price']:.2f}", f"{t['exit_price']:.2f}", f"{t['qty']:.8f}",
                    f"{t['gross_pnl_usd']:.4f}", f"{t['fees_usd']:.4f}", f"{t['net_pnl_usd']:.4f}", t['hold_s']])

result = {'spec': spec, 'spec_hash': spec_hash, 'metrics': metrics, 'verdict': verdict,
          'data_coverage': data_coverage, 'trade_count': len(trades),
          'engine_version': 'e2e-runner-0.1.0'}
json.dump(result, open(f'{SCRATCH}/e2e_result.json', 'w'), indent=2)

print(f"trades={len(trades)} net={metrics['net_pnl_usd']} gross={metrics['gross_pnl_usd']} fees={metrics['fees_usd']}")
print(f"win_rate={metrics['win_rate']} pf={metrics['profit_factor']} mdd={metrics['max_drawdown_usd']}")
print(f"verdict={verdict['overall']} criteria={[(c['id'], c['pass']) for c in criteria]}")
print(f"spec_hash={spec_hash}")
print('monthly:', metrics['monthly'])
