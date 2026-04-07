import type { NormalizedHospital } from '../../types/edas';
import { useDashboardStore } from '../../store/dashboardStore';

const CENSUS_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#eab308',
  3: '#f97316',
  4: '#ef4444',
};

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

  const sorted = [...hospitals].sort(
    (a, b) => (b.edCensusScore ?? 0) - (a.edCensusScore ?? 0),
  );

  return (
    <section>
      <div className="section-label mb-2">Live ED Status</div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {sorted.map((h) => {
          const color = CENSUS_COLORS[h.edCensusScore ?? 0] || '#6b7280';
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
