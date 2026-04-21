import type { NormalizedHospital } from '../../types/edas';
import { useDashboardStore } from '../../store/dashboardStore';

const CENSUS_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#eab308',
  3: '#f97316',
  4: '#ef4444',
};

const UNKNOWN_COLOR = '#9ca3af';

interface Props {
  hospitals: NormalizedHospital[];
  previousHospitals: NormalizedHospital[];
}

function getTrend(
  current: NormalizedHospital,
  previous: NormalizedHospital[],
): '↑' | '→' | '↓' | '' {
  const prev = previous.find((p) => p.code === current.code);
  if (!prev || prev.edCensusScore == null || current.edCensusScore == null) return '';
  if (current.edCensusScore > prev.edCensusScore) return '↑';
  if (current.edCensusScore < prev.edCensusScore) return '↓';
  return '→';
}

export default function LiveStatus({ hospitals, previousHospitals }: Props) {
  const selectHospital = useDashboardStore((s) => s.selectHospital);

  const sorted = [...hospitals].sort((a, b) => {
    // Hospitals with missing scores sort to the end — they are unknown, not zero.
    const aMissing = a.edCensusScore == null;
    const bMissing = b.edCensusScore == null;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return b.edCensusScore! - a.edCensusScore!;
  });

  return (
    <section>
      <div className="section-label mb-2">Live ED Status</div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {sorted.map((h) => {
          const color = h.edCensusScore == null
            ? UNKNOWN_COLOR
            : CENSUS_COLORS[h.edCensusScore] ?? UNKNOWN_COLOR;
          const trend = getTrend(h, previousHospitals);

          return (
            <button
              key={h.code}
              className="w-full flex items-center gap-2 py-1 px-1 rounded text-left hover:bg-elevated transition-colors"
              onClick={() => selectHospital(h.code)}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="flex-1 text-[11px] text-text-primary truncate">
                {h.name.replace(/\s*-\s*\d+$/, '')}
              </span>
              <span className="text-[10px] text-text-secondary">{h.system}</span>
              <span className="mono text-[11px] w-4 text-center" style={{ color }}>
                {h.edCensusScore ?? '—'}
              </span>
              <span className="mono text-[11px] w-6 text-center text-text-secondary">
                {h.numUnits}
              </span>
              <span className="mono text-[11px] w-4 text-center">
                {trend === '↑' && <span className="text-census-4">↑</span>}
                {trend === '↓' && <span className="text-census-1">↓</span>}
                {trend === '→' && <span className="text-text-muted">→</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
