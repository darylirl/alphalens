import type { CalibrationBin } from '@/lib/ledger/calls'

// Calibration curve: stated confidence vs observed hit rate, one point per
// 20%-wide confidence bin, dot area scaled by bin size. Pure server-rendered
// SVG — no client JS, no chart library. Rendered only once 10+ calls have
// resolved; below that the page shows the honest empty state instead.

const W = 320
const H = 220
const PAD = { l: 40, r: 12, t: 12, b: 34 }

const x = (p: number) => PAD.l + p * (W - PAD.l - PAD.r)
const y = (p: number) => H - PAD.b - p * (H - PAD.t - PAD.b)

export function CalibrationCurve({ bins, total }: { bins: CalibrationBin[]; total: number }) {
  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm" role="img"
        aria-label="Calibration: stated confidence versus observed hit rate">
        {/* gridlines + axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={x(0)} y1={y(p)} x2={x(1)} y2={y(p)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            <text x={x(0) - 6} y={y(p) + 3} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.4)">
              {Math.round(p * 100)}%
            </text>
            <text x={x(p)} y={H - PAD.b + 14} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)">
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {/* perfect-calibration diagonal */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="4 3" />
        {/* observed points, connected in confidence order */}
        <polyline
          points={bins.map((b) => `${x(b.predictedMean)},${y(b.observedRate)}`).join(' ')}
          fill="none" stroke="#34EAB9" strokeWidth={1.5}
        />
        {bins.map((b) => (
          <circle
            key={b.loPct}
            cx={x(b.predictedMean)} cy={y(b.observedRate)}
            r={3 + 5 * Math.sqrt(b.count / maxCount)}
            fill="#34EAB9" fillOpacity={0.35} stroke="#34EAB9" strokeWidth={1.5}
          />
        ))}
        <text x={(x(0) + x(1)) / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.55)">
          stated confidence → observed hit rate
        </text>
      </svg>
      <p className="text-[10px] text-white/40 mt-1">
        {total} resolved calls. Dots on the dashed line = perfectly calibrated;
        dot size = number of calls in that confidence band. Unresolvable calls
        (data gaps) are excluded — a gap is never scored either way.
      </p>
    </div>
  )
}
