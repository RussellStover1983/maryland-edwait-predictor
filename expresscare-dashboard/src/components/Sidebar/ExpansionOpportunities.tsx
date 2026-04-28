import { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import type { GravityResults, GravityExpansionOpportunity } from '../../hooks/useGravityModel';

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
  gravityData: GravityResults | null;
  gravityLoading: boolean;
}

type TimePeriod = 'average' | 'morning' | 'afternoon' | 'evening' | 'overnight';

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

const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
  average: 'Avg',
  morning: 'AM',
  afternoon: 'PM',
  evening: 'Eve',
  overnight: 'Night',
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

function getVolume(opp: GravityExpansionOpportunity, period: TimePeriod, scaleFactor: number): number {
  const base = period === 'average'
    ? opp.captured_daily_avg
    : opp.captured_by_period[period];
  return Math.round(base * scaleFactor * 10) / 10;
}

export default function ExpansionOpportunities({ hexScores, gravityData, gravityLoading }: Props) {
  const { setViewport, selectHex, selectedHex } = useDashboardStore();
  const [showHelp, setShowHelp] = useState(false);
  const [expandedHex, setExpandedHex] = useState<string | null>(null);
  const [divertiblePct, setDivertiblePct] = useState(20);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('average');

  const hasGravity = gravityData && gravityData.expansion_opportunities.length > 0;
  const configPct = gravityData?.config.divertible_pct ?? 0.20;
  const scaleFactor = (divertiblePct / 100) / configPct;

  // Gravity-based opportunities (ranked by captured volume)
  const gravityOpps = hasGravity ? gravityData.expansion_opportunities : [];

  // Fallback to hex-score ranking when gravity data unavailable
  const fallbackOpps = hexScores
    .filter((h) => h.tractGeoid.startsWith('24') && h.nearestExpressCare.distanceMiles > 8)
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 10);

  const hexLookup = new Map(hexScores.map((h) => [h.h3Index, h]));

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
        {gravityLoading && (
          <span className="text-[9px] text-text-muted animate-pulse">Loading model...</span>
        )}
      </div>

      {showHelp && (
        <div className="bg-elevated rounded p-3 mb-2 text-[10px] text-text-secondary leading-relaxed">
          <div className="text-[11px] text-text-primary font-bold mb-1">
            {hasGravity ? 'Gravity Model Volume Estimates' : 'What are Expansion Opportunities?'}
          </div>
          {hasGravity ? (
            <>
              <p className="mb-2">
                Volume estimates use a <span className="text-accent">Huff gravity model</span> combining
                HSCRC outpatient ED volume ({gravityData.statewide.total_outpatient_monthly.toLocaleString()} services/mo),
                ORS drive-time distances, and EDAS hourly census patterns.
              </p>
              <p className="mb-2">
                <span className="text-accent">Divertible %</span> controls what fraction of outpatient ED visits
                could shift to urgent care (literature: 13-27%). Volumes scale linearly with this parameter.
              </p>
              <p>
                <span className="text-accent">Time-of-day</span> adjusts hospital attractiveness by crowding patterns —
                busier hospitals push more patients to nearby urgent care.
              </p>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {hasGravity && (
        <div className="space-y-2 mb-3">
          {/* Divertible % slider */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-secondary whitespace-nowrap">Divertible %</span>
            <input
              type="range"
              min={13}
              max={27}
              value={divertiblePct}
              onChange={(e) => setDivertiblePct(Number(e.target.value))}
              className="flex-1 h-1 accent-accent"
            />
            <span className="mono text-[11px] text-accent w-8 text-right">{divertiblePct}%</span>
          </div>

          {/* Time-of-day toggle */}
          <div className="flex gap-1">
            {(Object.entries(TIME_PERIOD_LABELS) as [TimePeriod, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTimePeriod(key)}
                className={`flex-1 text-[9px] py-1 rounded transition-colors ${
                  timePeriod === key
                    ? 'bg-accent text-white'
                    : 'bg-elevated text-text-secondary hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        {hasGravity
          ? gravityOpps.map((opp, i) => {
              const hex = hexLookup.get(opp.h3Index);
              const isSelected = selectedHex === opp.h3Index;
              const isExpanded = expandedHex === opp.h3Index;
              const volume = getVolume(opp, timePeriod, scaleFactor);

              return (
                <div key={opp.h3Index}>
                  <div
                    className={`flex items-center gap-2 p-1.5 rounded transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-accent/20 border border-accent/40'
                        : 'hover:bg-elevated'
                    }`}
                    onClick={() => {
                      setViewport({ lat: opp.centroid.lat, lng: opp.centroid.lng, zoom: 13 });
                      selectHex(opp.h3Index);
                      setExpandedHex(isExpanded ? null : opp.h3Index);
                    }}
                  >
                    <span className="text-[10px] text-text-muted mono w-4">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-text-primary truncate">
                        {hex ? `Near ${hex.nearestExpressCare.name}` : `Hex ${opp.h3Index.slice(0, 10)}...`}
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        {opp.nearest_expresscare_miles}mi away
                        {' · '}Pop {opp.nearby_population_5mi.toLocaleString()} (5mi)
                        {' · '}Score {opp.base_score}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="mono text-[12px] text-accent font-bold">~{volume}</div>
                      <div className="text-[8px] text-text-muted">pts/day</div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="ml-6 mt-1 mb-2 p-2 bg-elevated rounded text-[10px] space-y-2">
                      {/* Time-of-day breakdown */}
                      <div>
                        <div className="text-text-primary font-bold text-[11px] mb-1">Volume by Time of Day</div>
                        <div className="grid grid-cols-4 gap-1 text-center">
                          {(['morning', 'afternoon', 'evening', 'overnight'] as const).map((p) => (
                            <div key={p} className={`rounded py-1 ${timePeriod === p ? 'bg-accent/20' : 'bg-bg'}`}>
                              <div className="text-[9px] text-text-muted">{TIME_PERIOD_LABELS[p]}</div>
                              <div className="mono text-[11px] text-text-primary">
                                {getVolume(opp, p, scaleFactor)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Captured from */}
                      {opp.captured_from.length > 0 && (
                        <div>
                          <div className="text-text-primary font-bold text-[11px] mb-1">Diverted From</div>
                          {opp.captured_from.map((cf) => (
                            <div key={cf.code} className="flex justify-between text-text-secondary">
                              <span className="truncate">{cf.hospital}</span>
                              <span className="mono text-census-4 whitespace-nowrap">
                                -{Math.round(cf.daily_lost * scaleFactor * 10) / 10}/day
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Score breakdown */}
                      {hex && (
                        <div>
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
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="border-t border-border pt-1.5 mt-1.5">
                        <div className="text-text-secondary">
                          Centroid: <span className="mono text-text-primary">
                            {opp.centroid.lat.toFixed(4)}, {opp.centroid.lng.toFixed(4)}
                          </span>
                        </div>
                        {hex && (
                          <div className="text-text-secondary">
                            Tract: <span className="mono text-text-primary">{hex.tractGeoid}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          : fallbackOpps.map((hex, i) => {
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
        {!hasGravity && fallbackOpps.length === 0 && (
          <div className="text-[11px] text-text-muted">No expansion opportunities found</div>
        )}
      </div>
    </section>
  );
}
