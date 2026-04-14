import { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';

interface FeatureDef {
  name: string;
  description: string;
  detail: string;
  source: string;
  importance: number;
}

interface SectionDef {
  title: string;
  features?: FeatureDef[];
  content?: React.ReactNode;
}

function ImportanceBar({ gain, maxGain }: { gain: number; maxGain: number }) {
  if (gain === 0 || maxGain === 0) {
    return <div className="h-[6px] w-[200px] bg-border rounded-full" />;
  }
  const pct = Math.max((gain / maxGain) * 100, 3);
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

function FeatureHelp({ detail }: { detail: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setShow(!show)}
        className="w-3.5 h-3.5 rounded-full border border-text-muted text-text-muted text-[9px] inline-flex items-center justify-center hover:border-accent hover:text-accent transition-colors"
      >
        ?
      </button>
      {show && (
        <div className="absolute left-5 top-0 z-50 w-[280px] bg-panel border border-border rounded p-2.5 shadow-xl text-[10px] text-text-secondary leading-relaxed">
          <button
            onClick={() => setShow(false)}
            className="absolute top-1 right-2 text-text-muted hover:text-text-primary text-[11px]"
          >
            x
          </button>
          {detail}
        </div>
      )}
    </span>
  );
}

function FeatureRow({ feature, maxGain }: { feature: FeatureDef; maxGain: number }) {
  return (
    <div className="py-1.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="mono text-[11px] text-accent">{feature.name}</span>
        <FeatureHelp detail={feature.detail} />
        <SourcePill label={feature.source} />
      </div>
      <div className="text-[10px] text-text-secondary mb-1">{feature.description}</div>
      <div className="flex items-center gap-2">
        <ImportanceBar gain={feature.importance} maxGain={maxGain} />
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

function EdasDefinitionsSection() {
  const definitions = [
    {
      category: 'Hospital Status',
      items: [
        { term: 'Destination Name', def: 'The name of the hospital or receiving facility as registered in the MIEMSS EDAS system.' },
        { term: 'Destination Code', def: 'A unique numeric identifier assigned to each hospital by MIEMSS. Used to link EDAS real-time data with HSCRC volume data and CMS provider records.' },
        { term: 'Jurisdiction', def: 'The Maryland county or jurisdiction the hospital serves. Hospitals may serve multiple jurisdictions.' },
      ],
    },
    {
      category: 'ED Census Indicator',
      items: [
        { term: 'Census Score', def: 'A 1-4 scale reflecting current ED capacity utilization, reported by each hospital to MIEMSS in real-time. Level 1 (Normal): 0-75% of functional capacity. Level 2 (Advisory): 76-100% of capacity. Level 3 (Alert): 101-130% of capacity, indicating significant crowding. Level 4 (Overcapacity): 131%+ of capacity, indicating severe crowding and potential diversion.' },
        { term: 'Capacity', def: 'A text field hospitals can use to communicate additional capacity details beyond the numeric census score.' },
      ],
    },
    {
      category: 'EMS Unit Tracking',
      items: [
        { term: 'Number of Units (numOfUnits)', def: 'Count of EMS units currently at the hospital. Includes units that have arrived and are waiting to transfer patient care. A high unit count indicates ambulance offload delays and ED congestion.' },
        { term: 'Number of Units Enroute (numOfUnitsEnroute)', def: 'Count of EMS units currently en route to the hospital. A leading indicator of incoming demand -- a spike in enroute units predicts near-term ED volume increase.' },
        { term: 'Length of Stay', def: 'Minutes an EMS unit has been at the hospital since arrival. Measured per unit. Long stays indicate patient offload delays (EMS crews waiting to transfer care because the ED has no available beds).' },
        { term: 'Min Stay / Max Stay', def: 'The shortest and longest EMS unit dwell times currently at the hospital. Max stay is a strong proxy for ED congestion severity -- when the longest-waiting ambulance crew has been there 2+ hours, the ED is severely backed up.' },
        { term: 'Time Enroute', def: 'Minutes an inbound EMS unit has been traveling to the hospital. Long enroute times may indicate the unit was diverted from a closer facility.' },
        { term: 'Unit Call Sign', def: 'The radio identifier for the EMS unit (e.g., MU02, MU18B). Identifies the specific ambulance crew.' },
        { term: 'Agency Name', def: 'The fire department or EMS agency operating the unit (e.g., Anne Arundel County Fire Dept, Baltimore City Fire Dept).' },
        { term: 'Is Enroute', def: 'Flag (0 or 1) indicating whether the unit is currently traveling to the hospital (1) or has already arrived (0).' },
      ],
    },
    {
      category: 'Alerts',
      items: [
        { term: 'Yellow Alert', def: 'Hospital has declared a Yellow Alert, indicating the ED is experiencing significant volume and requesting EMS units consider alternative destinations. Advisory only -- EMS is not required to divert.' },
        { term: 'Red Alert', def: 'Hospital has declared a Red Alert, indicating the ED is at or beyond capacity. Stronger advisory than Yellow. EMS units should strongly consider diverting to alternative facilities.' },
        { term: 'Re-Route', def: 'Hospital is actively requesting EMS re-route patients to other facilities. More directive than Yellow/Red alerts. Typically declared during extreme crowding or internal emergencies.' },
        { term: 'Code Black', def: 'Hospital has declared a Code Black, indicating an internal emergency (e.g., hazmat, active threat, mass casualty). The Code Black Reason field provides details. EMS should not transport to this facility.' },
        { term: 'Trauma Bypass', def: 'Hospital is bypassing trauma patients -- incoming trauma cases should be routed to the next nearest trauma center. May be due to trauma bay capacity, surgical team availability, or other resource constraints.' },
      ],
    },
    {
      category: 'Data Collection',
      items: [
        { term: 'Source', def: 'Maryland Institute for Emergency Medical Services Systems (MIEMSS) Emergency Department Application System (EDAS). Real-time, unauthenticated API at edas.miemss.org.' },
        { term: 'Collection Frequency', def: 'The EDAS collector polls every 5 minutes and stores snapshots in Railway Postgres. The frontend polls every 60 seconds for display. EDAS data is approximately real-time with a reporting lag of 1-5 minutes depending on the hospital.' },
        { term: 'Coverage', def: '62 hospitals across all 24 Maryland jurisdictions. Includes all acute care hospitals with emergency departments. Does not include freestanding emergency centers or urgent care facilities.' },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {definitions.map((cat) => (
        <div key={cat.category}>
          <div className="text-[11px] text-text-primary font-bold mb-1.5">{cat.category}</div>
          <div className="space-y-2">
            {cat.items.map((item) => (
              <div key={item.term} className="pl-2 border-l-2 border-border">
                <div className="text-[11px] text-accent">{item.term}</div>
                <div className="text-[10px] text-text-secondary leading-relaxed">{item.def}</div>
              </div>
            ))}
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
      { name: 'ed_census_score', description: 'EDAS capacity level (1=Normal, 2=Advisory, 3=Alert, 4=Overcapacity)', detail: 'The single most important predictor in the model (329K importance gain). Each Maryland hospital self-reports its ED census level to MIEMSS in real-time on a 1-4 scale. Level 1 = operating below 75% of functional capacity. Level 4 = over 131% capacity with significant patient boarding. This feature alone drives ~60% of the model\'s predictive power because future census is strongly autocorrelated with current census.', source: 'EDAS Live', importance: 329_771 },
      { name: 'num_units', description: 'EMS units currently at the ED', detail: 'Count of ambulance crews physically present at the hospital, either offloading patients or waiting for bed availability. High counts (4+) indicate ambulance offload delays, which are a hallmark of severe ED crowding. Each unit waiting represents an ambulance out of service for the community.', source: 'EDAS Live', importance: 706 },
      { name: 'num_units_enroute', description: 'EMS units inbound to the ED', detail: 'Count of ambulances currently traveling toward this hospital. This is a leading indicator: a spike in enroute units signals incoming demand that hasn\'t hit the ED yet. The model uses this to anticipate census increases 15-30 minutes before they materialize.', source: 'EDAS Live', importance: 261 },
      { name: 'min_stay_minutes', description: 'Shortest EMS unit dwell time at ED', detail: 'The fastest current patient handoff time at this ED. When even the shortest stay is long (>30 min), it suggests the ED is struggling to accept any patients quickly. A low min_stay alongside a high max_stay indicates uneven throughput.', source: 'EDAS Live', importance: 155 },
      { name: 'max_stay_minutes', description: 'Longest EMS unit dwell time (congestion proxy)', detail: 'The longest time any ambulance crew has been waiting at this ED. This is a strong congestion proxy: when the max stay exceeds 60-90 minutes, EMS crews are "wall timing" (standing with patients in the hallway because no ED beds are available). Max stays over 2 hours indicate a severely dysfunctional ED throughput situation.', source: 'EDAS Live', importance: 384 },
      { name: 'any_alert', description: 'Whether any alert is active (yellow/red/reroute/code black/trauma bypass)', detail: 'Binary flag (0 or 1) indicating if the hospital has declared any type of alert to MIEMSS. Alerts are voluntary declarations that signal operational stress. The model uses this as a broad indicator of abnormal ED conditions.', source: 'EDAS Live', importance: 27 },
      { name: 'alert_count', description: 'Number of active alerts', detail: 'Sum of all active alert types (0-5). Multiple simultaneous alerts (e.g., Yellow + Trauma Bypass) indicate compounding problems. Rare in practice -- most hospitals have 0-1 alerts at any time.', source: 'EDAS Live', importance: 5 },
    ],
  },
  {
    title: 'Historical Patterns (12)',
    features: [
      { name: 'census_lag_1h', description: 'Census score 1 hour ago', detail: 'The second most important feature in the model (69K gain). What the hospital\'s census score was 60 minutes ago provides strong signal about the current trajectory. Census scores are sticky -- a hospital at Level 3 an hour ago is very likely still at Level 3 or nearby.', source: 'Collector', importance: 69_023 },
      { name: 'census_lag_2h', description: 'Census score 2 hours ago', detail: 'Extends the historical context window. Combined with the 1h lag, the model can infer whether census is rising, falling, or stable over the past 2 hours.', source: 'Collector', importance: 1_122 },
      { name: 'census_lag_4h', description: 'Census score 4 hours ago', detail: 'Captures medium-term trends. A hospital that was Level 1 four hours ago but is now Level 3 is on a different trajectory than one that\'s been Level 3 all day.', source: 'Collector', importance: 1_096 },
      { name: 'census_lag_8h', description: 'Census score 8 hours ago', detail: 'Roughly one shift ago. Helps the model understand whether current conditions are an anomaly (e.g., sudden surge) or continuation of a longer pattern (e.g., all-day crowding).', source: 'Collector', importance: 1_038 },
      { name: 'census_lag_24h', description: 'Census score same time yesterday', detail: 'Same hour yesterday. Captures daily recurring patterns: if this ED is always at Level 3 at 2pm, that\'s different from an unusual spike. Ranks #5 overall in the model (4.9K gain).', source: 'Collector', importance: 4_923 },
      { name: 'census_rolling_3h', description: 'Mean census over past 3 hours', detail: 'The third most important feature (58K gain). Smooths out short-term fluctuations and captures the sustained trend. More predictive than any single lag because it represents the "regime" the hospital is in rather than a single snapshot.', source: 'Collector', importance: 58_370 },
      { name: 'census_rolling_6h', description: 'Mean census over past 6 hours', detail: 'Half-day rolling average. Captures whether the hospital has been under sustained pressure or is in a normal operating rhythm.', source: 'Collector', importance: 1_798 },
      { name: 'census_rolling_12h', description: 'Mean census over past 12 hours', detail: 'Full half-day context. High rolling averages over 12 hours suggest systemic issues (staffing, boarding, high acuity mix) rather than transient surges.', source: 'Collector', importance: 3_588 },
      { name: 'census_rolling_std_3h', description: 'Census volatility (std dev) over past 3 hours', detail: 'Measures how much the census score has been jumping around. A standard deviation of 0 means perfectly stable; high values indicate rapid fluctuations. Volatile hospitals are harder to predict and may warrant wider confidence intervals.', source: 'Collector', importance: 808 },
      { name: 'census_change_2h', description: 'Current score minus score 2 hours ago (trend)', detail: 'Directional momentum: positive means worsening, negative means improving, zero means stable. The model uses this to distinguish between a hospital that just hit Level 3 (rising) versus one that\'s been recovering from Level 4 (falling). Ranks #4 overall (5.6K gain).', source: 'Collector', importance: 5_576 },
      { name: 'units_rolling_3h', description: 'Mean EMS units over past 3 hours', detail: 'Smoothed EMS unit count. Sustained high unit counts over 3 hours are more concerning than a momentary spike. This feature captures ambulance offload delays as a systemic pattern rather than a one-off event.', source: 'Collector', importance: 1_614 },
      { name: 'max_stay_rolling_3h', description: 'Mean max dwell time over past 3 hours', detail: 'Sustained maximum EMS wait times. If the longest-waiting ambulance has been 90+ minutes for 3 hours straight, the ED has a persistent throughput bottleneck, not just a busy moment.', source: 'Collector', importance: 1_974 },
    ],
  },
  {
    title: 'Temporal & Calendar (8)',
    features: [
      { name: 'hour_sin', description: 'Time of day (cyclically encoded, sine)', detail: 'Hour of day encoded as sin(2*pi*hour/24). Cyclical encoding ensures the model treats 11pm and midnight as adjacent (unlike raw hour 23 vs 0). Combined with hour_cos, this gives the model a smooth circular representation of time-of-day. ED volumes follow strong diurnal patterns: lowest at 4-6am, rising through the morning, peaking at 11am-3pm, with a secondary peak in early evening.', source: 'Timestamp', importance: 2_807 },
      { name: 'hour_cos', description: 'Time of day (cyclically encoded, cosine)', detail: 'The cosine complement of the hour encoding. Together with hour_sin, these two features let the model learn that 10am and 2pm are equidistant from the noon peak, and that the transition from 11pm to midnight is smooth rather than a discontinuity.', source: 'Timestamp', importance: 4_045 },
      { name: 'dow_sin', description: 'Day of week (cyclically encoded, sine)', detail: 'Day of week encoded cyclically as sin(2*pi*day/7) where Monday=0, Sunday=6. Captures weekly patterns: Mondays tend to be the busiest ED day (post-weekend complaints), weekends have different acuity mixes (more trauma, less primary-care-avoidable visits).', source: 'Timestamp', importance: 549 },
      { name: 'dow_cos', description: 'Day of week (cyclically encoded, cosine)', detail: 'Cosine complement of day-of-week encoding. Together with dow_sin, ensures Saturday and Monday are correctly represented as two days apart rather than appearing at opposite ends of a linear scale.', source: 'Timestamp', importance: 406 },
      { name: 'month_sin', description: 'Month of year (cyclically encoded, sine)', detail: 'Month encoded as sin(2*pi*month/12). Captures seasonal ED volume patterns: flu season (Nov-Feb) drives higher volumes, summer months have different injury patterns. With only 7 days of training data currently, this feature has limited power but will strengthen with more data.', source: 'Timestamp', importance: 132 },
      { name: 'month_cos', description: 'Month of year (cyclically encoded, cosine)', detail: 'Cosine complement of month encoding. Ensures December and January are treated as adjacent months rather than 11 apart on a linear scale.', source: 'Timestamp', importance: 204 },
      { name: 'is_weekend', description: 'Saturday or Sunday flag', detail: 'Binary flag: 1 for Saturday/Sunday, 0 for weekdays. Weekend EDs tend to see different patient populations (more injuries, fewer employer-insured patients) and often operate with reduced ancillary staffing (imaging, lab, specialist consults), which affects throughput and boarding.', source: 'Timestamp', importance: 220 },
      { name: 'hour_linear', description: 'Hour of day (0-23)', detail: 'Raw hour as an integer 0-23. Provides a linear representation of time-of-day as a complement to the cyclical sin/cos encoding. Helps the model capture asymmetric patterns (e.g., the morning ramp-up from 6am-11am is steeper than the evening decline from 6pm-11pm).', source: 'Timestamp', importance: 1_939 },
    ],
  },
  {
    title: 'Environmental (3)',
    features: [
      { name: 'temperature_2m', description: 'Air temperature at 2m height (deg C)', detail: 'Hourly air temperature from Open-Meteo for the Baltimore region. Temperature affects ED volumes in both directions: extreme cold increases respiratory and cardiac events, extreme heat causes heat-related illness and dehydration. Moderate temperatures (15-25C) are associated with baseline ED activity. Ranks #9 overall in the model (2.8K gain).', source: 'Open-Meteo', importance: 2_808 },
      { name: 'precipitation', description: 'Precipitation (mm)', detail: 'Hourly precipitation from Open-Meteo. Rain and snow affect ED volumes through motor vehicle accidents, slip-and-fall injuries, and suppression of lower-acuity visits (people stay home in bad weather). Currently shows 0 importance, likely because the training period (7 days in April) had limited precipitation variation.', source: 'Open-Meteo', importance: 0 },
      { name: 'relative_humidity_2m', description: 'Relative humidity at 2m (%)', detail: 'Hourly relative humidity. High humidity compounds the effects of heat (heat index), and very low humidity is associated with respiratory irritation. Also acts as a proxy for overall weather conditions and comfort level that influences whether people seek ED care.', source: 'Open-Meteo', importance: 1_899 },
    ],
  },
  {
    title: 'Flu / ILI (2)',
    features: [
      { name: 'ili_rate', description: 'Weekly influenza-like illness rate, HHS Region 3 (%)', detail: 'Percentage of outpatient visits for influenza-like illness (fever + cough or sore throat) in HHS Region 3 (MD, DE, DC, PA, VA, WV) from the CDC FluView surveillance system via the Delphi epidata API. During flu season (Oct-Mar), ILI rates can reach 4-6%, driving significant ED volume increases. Currently 0 importance because the training data doesn\'t overlap with flu data coverage. Will activate once the weekly refresh pipeline extends coverage.', source: 'CDC FluView', importance: 0 },
      { name: 'ili_weeks_stale', description: 'Weeks since last reported ILI data (staleness indicator)', detail: 'How many weeks beyond the last available CDC FluView report the current prediction is. Allows the model to discount stale ILI data rather than treating an old flu rate as current. When this is 0, the ILI rate is from the current or prior week. When it\'s 3+, the rate is outdated and should be treated with lower confidence.', source: 'Derived', importance: 0 },
    ],
  },
  {
    title: 'HSCRC Hospital Baselines (5)',
    features: [
      { name: 'baseline_monthly_volume', description: 'Average monthly ED volume for this hospital x month (FY2017-2026, excl. COVID)', detail: 'The HSCRC monthly ED volume baseline tells the model what "normal" looks like for each hospital in each calendar month. A hospital that typically sees 40,000 ED services in January behaves differently at Census Level 3 than one that sees 15,000. This feature anchors the mean-reversion prediction: when current conditions deviate from the baseline, the model predicts gradual return. Data from 10 fiscal years of HSCRC reports with COVID period (Mar 2020 - Jun 2021) excluded.', source: 'HSCRC', importance: 1_182 },
      { name: 'baseline_monthly_visits', description: 'Average monthly ED visits for this hospital x month', detail: 'Similar to volume but counts actual visits rather than services. A single ED visit may generate multiple services (triage, labs, imaging). Visit count is a better measure of patient throughput demand, while volume reflects resource utilization intensity.', source: 'HSCRC', importance: 779 },
      { name: 'baseline_admit_rate', description: 'Historical ED admission rate (% of patients admitted)', detail: 'What fraction of this hospital\'s ED patients historically get admitted. High admit rates (>30%) indicate a sicker patient population, longer ED stays, and more boarding (admitted patients waiting in the ED for inpatient beds). Hospitals with chronically high admit rates have structurally longer wait times regardless of volume.', source: 'HSCRC', importance: 917 },
      { name: 'seasonal_index', description: "This month's volume relative to hospital's annual average", detail: 'Ratio of this month\'s average ED volume to the hospital\'s overall annual average. A seasonal index of 1.1 means this month is typically 10% busier than average. Captures patterns like January flu surges, July trauma spikes, and November holiday dips. Computed from non-COVID months only.', source: 'HSCRC', importance: 1_032 },
      { name: 'licensed_beds', description: 'Total licensed beds (sum across all rate centers)', detail: 'The hospital\'s total licensed bed capacity, summed across all rate centers (med/surg, ICU, psych, rehab, etc.) from HSCRC monthly reports. Larger hospitals can absorb volume surges more easily. Currently 0 importance, likely because bed count is highly correlated with hospital identity (the model already knows each hospital via hospital_code_encoded).', source: 'HSCRC', importance: 0 },
    ],
  },
  {
    title: 'EDAS Data Definitions',
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
          const isEdasDefs = section.title === 'EDAS Data Definitions';
          const isModelOverview = section.title === 'Model Overview';

          return (
            <CollapsibleSection
              key={section.title}
              title={section.title}
              defaultOpen={isModelOverview}
            >
              {isEdasDefs ? (
                <EdasDefinitionsSection />
              ) : isHexScoring ? (
                <HexScoringSection />
              ) : isDataSources ? (
                <DataSourcesTable />
              ) : section.content ? (
                section.content
              ) : section.features ? (
                <div className="space-y-0">
                  {(() => {
                    const sectionMax = Math.max(...section.features!.map((f) => f.importance), 1);
                    return section.features!.map((f) => (
                      <FeatureRow key={f.name} feature={f} maxGain={sectionMax} />
                    ));
                  })()}
                </div>
              ) : null}
            </CollapsibleSection>
          );
        })}
      </div>
    </div>
  );
}
