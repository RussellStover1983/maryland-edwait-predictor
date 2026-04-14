import { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';

interface FeatureDef {
  name: string;
  description: string;
  source: string;
  importance: number;
}

interface SectionDef {
  title: string;
  features?: FeatureDef[];
  content?: React.ReactNode;
}

const MAX_IMPORTANCE = 329_771;

function ImportanceBar({ gain }: { gain: number }) {
  if (gain === 0) {
    return <div className="h-[6px] w-[200px] bg-border rounded-full" />;
  }
  const pct = Math.max((gain / MAX_IMPORTANCE) * 100, 1);
  return (
    <div className="h-[6px] w-[200px] bg-border rounded-full overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, backgroundColor: 'rgba(59, 130, 246, 0.6)' }}
      />
    </div>
  );
}

function SourcePill({ label }: { label: string }) {
  return (
    <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-elevated text-text-secondary border border-border">
      {label}
    </span>
  );
}

function FeatureRow({ feature }: { feature: FeatureDef }) {
  return (
    <div className="py-1.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="mono text-[11px] text-accent">{feature.name}</span>
        <SourcePill label={feature.source} />
      </div>
      <div className="text-[10px] text-text-secondary mb-1">{feature.description}</div>
      <div className="flex items-center gap-2">
        <ImportanceBar gain={feature.importance} />
        <span className="mono text-[9px] text-text-muted">{feature.importance.toLocaleString()}</span>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        className="w-full flex items-center justify-between py-2 px-1 text-left hover:bg-elevated transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="section-label">{title}</span>
        <span className="text-[11px] text-text-muted">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && <div className="pb-3 px-1">{children}</div>}
    </div>
  );
}

function HexScoringSection() {
  const components = [
    { label: 'Health Burden', weight: 35, color: '#ef4444', desc: 'Composite of diabetes prevalence, asthma, uninsured rate, lack of routine checkup, frequent mental distress -- from CDC PLACES via GeoHealth API' },
    { label: 'Social Vulnerability', weight: 25, color: '#f97316', desc: 'CDC Social Vulnerability Index composite (rpl_themes) -- measures census tract vulnerability across socioeconomic, household/disability, minority/language, and housing/transportation themes' },
    { label: 'Coverage Gap', weight: 25, color: '#eab308', desc: 'Linear distance to nearest ExpressCare location -- 2mi = 0% gap, 15mi+ = 100% gap' },
    { label: 'Population Density', weight: 15, color: '#3b82f6', desc: 'Square root normalized tract population -- higher population = higher demand potential' },
  ];

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-text-secondary mb-2">
        Composite = round((0.35 x health + 0.25 x svi + 0.25 x gap + 0.15 x pop) x 100)
      </div>
      {/* Stacked bar */}
      <div className="flex h-6 rounded overflow-hidden">
        {components.map((c) => (
          <div
            key={c.label}
            className="flex items-center justify-center text-[9px] font-bold text-white"
            style={{ width: `${c.weight}%`, backgroundColor: c.color }}
          >
            {c.weight}%
          </div>
        ))}
      </div>
      {/* Component details */}
      {components.map((c) => (
        <div key={c.label} className="flex gap-2">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
            style={{ backgroundColor: c.color }}
          />
          <div>
            <div className="text-[11px] text-text-primary font-bold">
              {c.label} ({c.weight}%)
            </div>
            <div className="text-[10px] text-text-secondary">{c.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DataSourcesTable() {
  const sources = [
    { name: 'EDAS (MIEMSS)', endpoint: 'edas.miemss.org', refresh: '5 min (collector), 60s (frontend)', auth: 'Unauthenticated' },
    { name: 'GeoHealth API', endpoint: 'geohealth-api-production.up.railway.app', refresh: 'Static (one-time batch)', auth: 'X-API-Key' },
    { name: 'Open-Meteo', endpoint: 'api.open-meteo.com', refresh: 'Hourly', auth: 'None' },
    { name: 'CDC FluView', endpoint: 'api.delphi.cmu.edu', refresh: 'Weekly', auth: 'None' },
    { name: 'HSCRC Volume', endpoint: 'hscrc.maryland.gov', refresh: 'Annually (manual download)', auth: 'None' },
    { name: 'CMS Care Compare', endpoint: 'data.cms.gov', refresh: 'Quarterly', auth: 'None' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-text-secondary border-b border-border">
            <th className="text-left py-1 pr-2">Source</th>
            <th className="text-left py-1 pr-2">Endpoint</th>
            <th className="text-left py-1 pr-2">Refresh</th>
            <th className="text-left py-1">Auth</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.name} className="border-b border-border last:border-b-0">
              <td className="py-1.5 pr-2 text-text-primary font-bold">{s.name}</td>
              <td className="py-1.5 pr-2 mono text-text-secondary">{s.endpoint}</td>
              <td className="py-1.5 pr-2 text-text-secondary">{s.refresh}</td>
              <td className="py-1.5 text-text-muted">{s.auth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS: SectionDef[] = [
  {
    title: 'Model Overview',
    content: (
      <div className="space-y-2">
        {[
          ['Algorithm', 'LightGBM (Gradient Boosted Trees)'],
          ['Horizons', '1-hour (MAE: 0.18) and 4-hour (MAE: 0.36)'],
          ['Training data', '49,939 snapshots from 73 hospitals'],
          ['Collection period', 'April 7-13 2026 (growing daily)'],
          ['Trees', '115 (1h) / 111 (4h)'],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between items-start gap-2">
            <span className="text-[10px] text-text-secondary">{label}</span>
            <span className="text-[11px] text-text-primary mono text-right">{value}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Real-time ED State (7)',
    features: [
      { name: 'ed_census_score', description: 'EDAS capacity level (1=Normal, 2=Advisory, 3=Alert, 4=Overcapacity)', source: 'EDAS Live', importance: 329_771 },
      { name: 'num_units', description: 'EMS units currently at the ED', source: 'EDAS Live', importance: 706 },
      { name: 'num_units_enroute', description: 'EMS units inbound to the ED', source: 'EDAS Live', importance: 261 },
      { name: 'min_stay_minutes', description: 'Shortest EMS unit dwell time at ED', source: 'EDAS Live', importance: 155 },
      { name: 'max_stay_minutes', description: 'Longest EMS unit dwell time (congestion proxy)', source: 'EDAS Live', importance: 384 },
      { name: 'any_alert', description: 'Whether any alert is active (yellow/red/reroute/code black/trauma bypass)', source: 'EDAS Live', importance: 27 },
      { name: 'alert_count', description: 'Number of active alerts', source: 'EDAS Live', importance: 5 },
    ],
  },
  {
    title: 'Historical Patterns (12)',
    features: [
      { name: 'census_lag_1h', description: 'Census score 1 hour ago', source: 'Collector', importance: 69_023 },
      { name: 'census_lag_2h', description: 'Census score 2 hours ago', source: 'Collector', importance: 1_122 },
      { name: 'census_lag_4h', description: 'Census score 4 hours ago', source: 'Collector', importance: 1_096 },
      { name: 'census_lag_8h', description: 'Census score 8 hours ago', source: 'Collector', importance: 1_038 },
      { name: 'census_lag_24h', description: 'Census score same time yesterday', source: 'Collector', importance: 4_923 },
      { name: 'census_rolling_3h', description: 'Mean census over past 3 hours', source: 'Collector', importance: 58_370 },
      { name: 'census_rolling_6h', description: 'Mean census over past 6 hours', source: 'Collector', importance: 1_798 },
      { name: 'census_rolling_12h', description: 'Mean census over past 12 hours', source: 'Collector', importance: 3_588 },
      { name: 'census_rolling_std_3h', description: 'Census volatility (std dev) over past 3 hours', source: 'Collector', importance: 808 },
      { name: 'census_change_2h', description: 'Current score minus score 2 hours ago (trend)', source: 'Collector', importance: 5_576 },
      { name: 'units_rolling_3h', description: 'Mean EMS units over past 3 hours', source: 'Collector', importance: 1_614 },
      { name: 'max_stay_rolling_3h', description: 'Mean max dwell time over past 3 hours', source: 'Collector', importance: 1_974 },
    ],
  },
  {
    title: 'Temporal & Calendar (8)',
    features: [
      { name: 'hour_sin', description: 'Time of day (cyclically encoded, sine)', source: 'Timestamp', importance: 2_807 },
      { name: 'hour_cos', description: 'Time of day (cyclically encoded, cosine)', source: 'Timestamp', importance: 4_045 },
      { name: 'dow_sin', description: 'Day of week (cyclically encoded, sine)', source: 'Timestamp', importance: 549 },
      { name: 'dow_cos', description: 'Day of week (cyclically encoded, cosine)', source: 'Timestamp', importance: 406 },
      { name: 'month_sin', description: 'Month of year (cyclically encoded, sine)', source: 'Timestamp', importance: 132 },
      { name: 'month_cos', description: 'Month of year (cyclically encoded, cosine)', source: 'Timestamp', importance: 204 },
      { name: 'is_weekend', description: 'Saturday or Sunday flag', source: 'Timestamp', importance: 220 },
      { name: 'hour_linear', description: 'Hour of day (0-23)', source: 'Timestamp', importance: 1_939 },
    ],
  },
  {
    title: 'Environmental (3)',
    features: [
      { name: 'temperature_2m', description: 'Air temperature at 2m height (deg C)', source: 'Open-Meteo', importance: 2_808 },
      { name: 'precipitation', description: 'Precipitation (mm)', source: 'Open-Meteo', importance: 0 },
      { name: 'relative_humidity_2m', description: 'Relative humidity at 2m (%)', source: 'Open-Meteo', importance: 1_899 },
    ],
  },
  {
    title: 'Flu / ILI (2)',
    features: [
      { name: 'ili_rate', description: 'Weekly influenza-like illness rate, HHS Region 3 (%)', source: 'CDC FluView', importance: 0 },
      { name: 'ili_weeks_stale', description: 'Weeks since last reported ILI data (staleness indicator)', source: 'Derived', importance: 0 },
    ],
  },
  {
    title: 'HSCRC Hospital Baselines (5)',
    features: [
      { name: 'baseline_monthly_volume', description: 'Average monthly ED volume for this hospital x month (FY2017-2026, excl. COVID)', source: 'HSCRC', importance: 1_182 },
      { name: 'baseline_monthly_visits', description: 'Average monthly ED visits for this hospital x month', source: 'HSCRC', importance: 779 },
      { name: 'baseline_admit_rate', description: 'Historical ED admission rate (% of patients admitted)', source: 'HSCRC', importance: 917 },
      { name: 'seasonal_index', description: "This month's volume relative to hospital's annual average", source: 'HSCRC', importance: 1_032 },
      { name: 'licensed_beds', description: 'Total licensed beds (sum across all rate centers)', source: 'HSCRC', importance: 0 },
    ],
  },
  {
    title: 'Hex Grid Scoring',
  },
  {
    title: 'Data Sources',
  },
];

export default function DataDefinitionsPanel() {
  const { showDataDefinitions, toggleDataDefinitions } = useDashboardStore();

  if (!showDataDefinitions) return null;

  return (
    <div className="absolute top-0 right-0 h-full w-[480px] z-[2000] bg-panel border-l border-border flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <span className="section-label text-[13px]">Data Definitions</span>
        <button
          onClick={toggleDataDefinitions}
          className="text-text-muted hover:text-text-primary transition-colors text-[16px] leading-none"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-0">
        {SECTIONS.map((section) => {
          const isHexScoring = section.title === 'Hex Grid Scoring';
          const isDataSources = section.title === 'Data Sources';
          const isModelOverview = section.title === 'Model Overview';

          return (
            <CollapsibleSection
              key={section.title}
              title={section.title}
              defaultOpen={isModelOverview}
            >
              {isHexScoring ? (
                <HexScoringSection />
              ) : isDataSources ? (
                <DataSourcesTable />
              ) : section.content ? (
                section.content
              ) : section.features ? (
                <div className="space-y-0">
                  {section.features.map((f) => (
                    <FeatureRow key={f.name} feature={f} />
                  ))}
                </div>
              ) : null}
            </CollapsibleSection>
          );
        })}
      </div>
    </div>
  );
}
