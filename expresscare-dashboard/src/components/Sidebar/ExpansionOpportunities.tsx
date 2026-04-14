import { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';

interface HexBaseScore {
  h3Index: string;
  baseScore: number;
  tractGeoid: string;
  centroid: { lat: number; lng: number };
  components: {
    healthBurden: number;
    socialVulnerability: number;
    coverageGap: number;
    populationDensity: number;
  };
  population: number;
  nearestExpressCare: { id: string; name: string; distanceMiles: number };
}

interface Props {
  hexScores: HexBaseScore[];
}

const WEIGHT_LABELS: Record<string, { label: string; weight: string; desc: string }> = {
  healthBurden: {
    label: 'Health Burden',
    weight: '35%',
    desc: 'Diabetes, asthma, uninsured rate, lack of routine checkup, frequent mental distress (CDC PLACES)',
  },
  socialVulnerability: {
    label: 'Social Vulnerability',
    weight: '25%',
    desc: 'CDC SVI composite across socioeconomic, household/disability, minority/language, and housing themes',
  },
  coverageGap: {
    label: 'Coverage Gap',
    weight: '25%',
    desc: 'Distance to nearest ExpressCare location (2mi = 0%, 15mi+ = 100%)',
  },
  populationDensity: {
    label: 'Population Density',
    weight: '15%',
    desc: 'Census tract population relative to the state maximum',
  },
};

function componentBar(value: number, color: string) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${value * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="mono text-[10px] text-text-secondary w-8">
        {(value * 100).toFixed(0)}
      </span>
    </div>
  );
}

export default function ExpansionOpportunities({ hexScores }: Props) {
  const { setViewport, selectHex, selectedHex } = useDashboardStore();
  const [showHelp, setShowHelp] = useState(false);
  const [expandedHex, setExpandedHex] = useState<string | null>(null);

  const opportunities = hexScores
    .filter((h) => h.tractGeoid.startsWith('24') && h.nearestExpressCare.distanceMiles > 8)
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 10);

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div className="section-label">Expansion Opportunities</div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="w-4 h-4 rounded-full border border-text-muted text-text-muted text-[10px] flex items-center justify-center hover:border-accent hover:text-accent transition-colors"
          title="What are expansion opportunities?"
        >
          ?
        </button>
      </div>

      {showHelp && (
        <div className="bg-elevated rounded p-3 mb-2 text-[10px] text-text-secondary leading-relaxed">
          <div className="text-[11px] text-text-primary font-bold mb-1">
            What are Expansion Opportunities?
          </div>
          <p className="mb-2">
            These are Maryland locations with the highest unmet demand for urgent care.
            Each hex cell (~0.3 mi across) is scored 0-100 based on four weighted factors:
          </p>
          <div className="space-y-1 mb-2">
            <div><span className="text-accent">35%</span> Health Burden — chronic disease prevalence, uninsured rate, mental health distress</div>
            <div><span className="text-accent">25%</span> Social Vulnerability — CDC SVI composite (socioeconomic, housing, minority/language factors)</div>
            <div><span className="text-accent">25%</span> Coverage Gap — distance to the nearest ExpressCare location</div>
            <div><span className="text-accent">15%</span> Population Density — census tract population</div>
          </div>
          <p>
            Cells shown here scored above 65 and are more than 8 miles from any
            existing ExpressCare location. Clicking a cell zooms to its location
            and highlights it on the map.
          </p>
        </div>
      )}

      <div className="space-y-1">
        {opportunities.map((hex, i) => {
          const isSelected = selectedHex === hex.h3Index;
          const isExpanded = expandedHex === hex.h3Index;

          return (
            <div key={hex.h3Index}>
              <div
                className={`flex items-center gap-2 p-1.5 rounded transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-accent/20 border border-accent/40'
                    : 'hover:bg-elevated'
                }`}
                onClick={() => {
                  setViewport({ lat: hex.centroid.lat, lng: hex.centroid.lng, zoom: 13 });
                  selectHex(hex.h3Index);
                  setExpandedHex(isExpanded ? null : hex.h3Index);
                }}
              >
                <span className="text-[10px] text-text-muted mono w-4">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-text-primary truncate">
                    Near {hex.nearestExpressCare.name}
                  </div>
                  <div className="text-[10px] text-text-secondary">
                    {hex.nearestExpressCare.distanceMiles}mi away · Pop {hex.population.toLocaleString()}
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

              {isExpanded && (
                <div className="ml-6 mt-1 mb-2 p-2 bg-elevated rounded text-[10px] space-y-1.5">
                  <div className="text-text-primary font-bold text-[11px] mb-1">Score Breakdown</div>
                  {Object.entries(hex.components).map(([key, value]) => {
                    const meta = WEIGHT_LABELS[key];
                    if (!meta) return null;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between">
                          <span className="text-text-secondary">
                            {meta.label} <span className="text-text-muted">({meta.weight})</span>
                          </span>
                        </div>
                        {componentBar(value, '#3b82f6')}
                        <div className="text-text-muted text-[9px] mt-0.5">{meta.desc}</div>
                      </div>
                    );
                  })}
                  <div className="border-t border-border pt-1.5 mt-1.5">
                    <div className="text-text-secondary">
                      Tract: <span className="mono text-text-primary">{hex.tractGeoid}</span>
                    </div>
                    <div className="text-text-secondary">
                      Centroid: <span className="mono text-text-primary">
                        {hex.centroid.lat.toFixed(4)}, {hex.centroid.lng.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
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
