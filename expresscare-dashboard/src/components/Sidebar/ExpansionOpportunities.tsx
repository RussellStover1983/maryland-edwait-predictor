import { useDashboardStore } from '../../store/dashboardStore';

interface HexBaseScore {
  h3Index: string;
  baseScore: number;
  components: {
    healthBurden: number;
    socialVulnerability: number;
    coverageGap: number;
    populationDensity: number;
  };
  population: number;
  nearestExpressCare: { id: string; name: string; distanceMiles: number };
}

interface HexCell {
  h3Index: string;
  centroid: { lat: number; lng: number };
}

interface Props {
  hexScores: HexBaseScore[];
  hexGrid: HexCell[];
}

function primaryDriver(c: HexBaseScore['components']): string {
  const entries: [string, number][] = [
    ['Health', c.healthBurden],
    ['SVI', c.socialVulnerability],
    ['Gap', c.coverageGap],
    ['Pop', c.populationDensity],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export default function ExpansionOpportunities({ hexScores, hexGrid }: Props) {
  const setViewport = useDashboardStore((s) => s.setViewport);
  const centroidMap = new Map(hexGrid.map((h) => [h.h3Index, h.centroid]));

  const opportunities = hexScores
    .filter((h) => h.nearestExpressCare.distanceMiles > 8)
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 10);

  return (
    <section>
      <div className="section-label mb-2">Expansion Opportunities</div>
      <div className="space-y-1">
        {opportunities.map((hex, i) => {
          const centroid = centroidMap.get(hex.h3Index);
          const driver = primaryDriver(hex.components);

          return (
            <div
              key={hex.h3Index}
              className="flex items-center gap-2 p-1.5 rounded hover:bg-elevated transition-colors cursor-pointer"
              onClick={() => {
                if (centroid) setViewport({ lat: centroid.lat, lng: centroid.lng, zoom: 11 });
              }}
            >
              <span className="text-[10px] text-text-muted mono w-4">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-text-primary truncate">
                  Near {hex.nearestExpressCare.name}
                </div>
                <div className="text-[10px] text-text-secondary">
                  {hex.nearestExpressCare.distanceMiles}mi away · Pop {hex.population.toLocaleString()} · {driver}
                </div>
              </div>
              <div className="w-12 h-2 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${hex.baseScore}%`,
                    backgroundColor: hex.baseScore > 70 ? '#ef4444' : hex.baseScore > 50 ? '#f97316' : '#eab308',
                  }}
                />
              </div>
              <span className="mono text-[11px] text-text-secondary w-6 text-right">
                {hex.baseScore}
              </span>
            </div>
          );
        })}
        {opportunities.length === 0 && (
          <div className="text-[11px] text-text-muted">No expansion opportunities found</div>
        )}
      </div>
    </section>
  );
}
