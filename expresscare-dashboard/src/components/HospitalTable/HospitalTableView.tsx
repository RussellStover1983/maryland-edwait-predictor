import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useDashboardStore } from '../../store/dashboardStore';
import {
  useHospitalSummary,
  useHospitalTimeSeries,
} from '../../hooks/useHospitalHistory';
import type { HospitalSummaryRow } from '../../hooks/useHospitalHistory';
import type { NormalizedHospital } from '../../types/edas';

const CENSUS_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#eab308',
  3: '#f97316',
  4: '#ef4444',
};

function censusColor(score: number | null): string {
  if (score == null) return '#6b7280';
  const rounded = Math.round(score);
  return CENSUS_COLORS[Math.min(Math.max(rounded, 1), 4)] ?? '#6b7280';
}

type SortKey =
  | 'name'
  | 'census'
  | 'avg7d'
  | 'max7d'
  | 'units'
  | 'avgStay'
  | 'alerts'
  | 'trend';

interface MergedHospital {
  code: string;
  name: string;
  system: string;
  liveCensus: number | null;
  liveUnits: number;
  avg7d: number | null;
  max7d: number | null;
  avgStay: number | null;
  alerts7d: number;
  trend: 'up' | 'down' | 'flat';
}

function mergeData(
  hospitals: NormalizedHospital[],
  summary: HospitalSummaryRow[],
): MergedHospital[] {
  const summaryMap = new Map(summary.map((s) => [s.hospital_code, s]));

  return hospitals.map((h) => {
    const s = summaryMap.get(h.code);
    const avg7d = s?.avg_census ? parseFloat(s.avg_census) : null;
    const liveCensus = h.edCensusScore;
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (liveCensus != null && avg7d != null) {
      if (liveCensus > avg7d + 0.3) trend = 'up';
      else if (liveCensus < avg7d - 0.3) trend = 'down';
    }

    return {
      code: h.code,
      name: h.name.replace(/\s*-\s*\d+$/, ''),
      system: h.system,
      liveCensus,
      liveUnits: h.numUnits,
      avg7d,
      max7d: s?.max_census ?? null,
      avgStay: s?.avg_max_stay ? parseFloat(s.avg_max_stay) : null,
      alerts7d: s ? parseInt(s.total_alert_snapshots, 10) : 0,
      trend,
    };
  });
}

function getSortValue(h: MergedHospital, key: SortKey): number | string {
  switch (key) {
    case 'name': return h.name.toLowerCase();
    case 'census': return h.liveCensus ?? -1;
    case 'avg7d': return h.avg7d ?? -1;
    case 'max7d': return h.max7d ?? -1;
    case 'units': return h.liveUnits;
    case 'avgStay': return h.avgStay ?? -1;
    case 'alerts': return h.alerts7d;
    case 'trend': return h.trend === 'up' ? 2 : h.trend === 'flat' ? 1 : 0;
  }
}

interface Props {
  hospitals: NormalizedHospital[];
}

export default function HospitalTableView({ hospitals }: Props) {
  const { selectedTableHospital, selectTableHospital, setView } =
    useDashboardStore();
  const { data: summary, loading: summaryLoading } = useHospitalSummary();
  const [activeTab, setActiveTab] = useState<'all' | 'detail'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('census');
  const [sortAsc, setSortAsc] = useState(false);

  const merged = useMemo(() => mergeData(hospitals, summary), [hospitals, summary]);

  const sorted = useMemo(() => {
    const arr = [...merged];
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return arr;
  }, [merged, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function handleRowClick(code: string) {
    selectTableHospital(code);
    setActiveTab('detail');
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  }

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-panel">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('map')}
            className="text-[11px] text-accent hover:underline"
          >
            &larr; Back to Map
          </button>
          <span className="text-[15px] font-bold text-text-primary">
            Hospital Data Explorer
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-panel px-4">
        <button
          onClick={() => setActiveTab('all')}
          className={`py-2 px-3 text-[11px] font-bold border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          All Hospitals
        </button>
        <button
          onClick={() => {
            if (selectedTableHospital) setActiveTab('detail');
          }}
          className={`py-2 px-3 text-[11px] font-bold border-b-2 transition-colors ${
            activeTab === 'detail'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          } ${!selectedTableHospital ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Hospital Detail
        </button>
      </div>

      {/* Content */}
      {activeTab === 'all' ? (
        <AllHospitalsTab
          sorted={sorted}
          summaryLoading={summaryLoading}
          onRowClick={handleRowClick}
          onSort={handleSort}
          sortIndicator={sortIndicator}
        />
      ) : selectedTableHospital ? (
        <HospitalDetailTab
          code={selectedTableHospital}
          hospitals={hospitals}
          summary={summary}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-muted text-[12px]">
          Select a hospital from the table
        </div>
      )}
    </div>
  );
}

/* ---------- All Hospitals Tab ---------- */

function AllHospitalsTab({
  sorted,
  summaryLoading,
  onRowClick,
  onSort,
  sortIndicator,
}: {
  sorted: MergedHospital[];
  summaryLoading: boolean;
  onRowClick: (code: string) => void;
  onSort: (key: SortKey) => void;
  sortIndicator: (key: SortKey) => string;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      {summaryLoading && sorted.length === 0 && (
        <div className="p-4 text-text-muted text-[11px]">Loading historical data...</div>
      )}
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-panel z-10">
          <tr className="border-b border-border text-text-secondary">
            <Th onClick={() => onSort('name')} label={`Hospital${sortIndicator('name')}`} align="left" />
            <Th onClick={() => onSort('census')} label={`Census${sortIndicator('census')}`} />
            <Th onClick={() => onSort('avg7d')} label={`7d Avg${sortIndicator('avg7d')}`} />
            <Th onClick={() => onSort('max7d')} label={`7d Max${sortIndicator('max7d')}`} />
            <Th onClick={() => onSort('units')} label={`EMS Units${sortIndicator('units')}`} />
            <Th onClick={() => onSort('avgStay')} label={`Avg Stay${sortIndicator('avgStay')}`} />
            <Th onClick={() => onSort('alerts')} label={`Alerts (7d)${sortIndicator('alerts')}`} />
            <Th onClick={() => onSort('trend')} label={`Trend${sortIndicator('trend')}`} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr
              key={h.code}
              onClick={() => onRowClick(h.code)}
              className="border-b border-border hover:bg-elevated transition-colors cursor-pointer"
            >
              <td className="py-2 px-3 text-left">
                <div className="text-text-primary">{h.name}</div>
                <div className="text-[9px] text-text-secondary">{h.system}</div>
              </td>
              <td className="py-2 px-3 text-center">
                <span
                  className="inline-block mono px-1.5 py-0.5 rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: censusColor(h.liveCensus) + '20',
                    color: censusColor(h.liveCensus),
                  }}
                >
                  {h.liveCensus ?? '--'}
                </span>
              </td>
              <td className="py-2 px-3 text-center mono" style={{ color: censusColor(h.avg7d) }}>
                {h.avg7d != null ? h.avg7d.toFixed(1) : '--'}
              </td>
              <td className="py-2 px-3 text-center mono" style={{ color: censusColor(h.max7d) }}>
                {h.max7d ?? '--'}
              </td>
              <td className="py-2 px-3 text-center mono text-text-primary">{h.liveUnits}</td>
              <td className="py-2 px-3 text-center mono text-text-secondary">
                {h.avgStay != null ? `${Math.round(h.avgStay)}m` : '--'}
              </td>
              <td className="py-2 px-3 text-center mono text-text-secondary">{h.alerts7d}</td>
              <td className="py-2 px-3 text-center">
                {h.trend === 'up' && <span className="text-census-4">&#x2191;</span>}
                {h.trend === 'down' && <span className="text-census-1">&#x2193;</span>}
                {h.trend === 'flat' && <span className="text-text-muted">&#x2192;</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  onClick,
  label,
  align = 'center',
}: {
  onClick: () => void;
  label: string;
  align?: 'left' | 'center';
}) {
  return (
    <th
      onClick={onClick}
      className={`py-2 px-3 font-bold cursor-pointer hover:text-text-primary transition-colors select-none whitespace-nowrap text-${align}`}
    >
      {label}
    </th>
  );
}

/* ---------- Hospital Detail Tab ---------- */

function HospitalDetailTab({
  code,
  hospitals,
  summary,
}: {
  code: string;
  hospitals: NormalizedHospital[];
  summary: HospitalSummaryRow[];
}) {
  const [timeRange, setTimeRange] = useState(24);

  const hospital = hospitals.find((h) => h.code === code);
  const summaryRow = summary.find((s) => s.hospital_code === code);
  const { data: timeSeries, loading } = useHospitalTimeSeries(code, timeRange);

  const displayName = hospital
    ? hospital.name.replace(/\s*-\s*\d+$/, '')
    : summaryRow?.hospital_name ?? code;
  const system = hospital?.system ?? 'Other';
  const liveCensus = hospital?.edCensusScore ?? null;

  const avg7d = summaryRow?.avg_census ? parseFloat(summaryRow.avg_census) : null;
  const avgUnits7d = summaryRow?.avg_units ? parseFloat(summaryRow.avg_units) : null;
  const avgMaxStay7d = summaryRow?.avg_max_stay
    ? parseFloat(summaryRow.avg_max_stay)
    : null;
  const alerts7d = summaryRow ? parseInt(summaryRow.total_alert_snapshots, 10) : 0;

  const chartData = timeSeries.map((row) => ({
    time: new Date(row.hour).toLocaleTimeString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
    }),
    avgCensus: parseFloat(row.avg_census),
    maxCensus: row.max_census,
    avgUnits: parseFloat(row.avg_units),
    maxUnits: row.max_units,
  }));

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[18px] font-bold mono"
          style={{
            backgroundColor: censusColor(liveCensus) + '20',
            color: censusColor(liveCensus),
          }}
        >
          {liveCensus ?? '--'}
        </span>
        <div>
          <div className="text-[15px] font-bold text-text-primary">{displayName}</div>
          <div className="text-[10px] text-text-secondary">{system}</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard
          label="Census"
          value={liveCensus?.toString() ?? '--'}
          sub={avg7d != null ? `7d avg: ${avg7d.toFixed(1)}` : ''}
          color={censusColor(liveCensus)}
        />
        <StatCard
          label="EMS Units"
          value={hospital?.numUnits?.toString() ?? '--'}
          sub={avgUnits7d != null ? `7d avg: ${avgUnits7d.toFixed(1)}` : ''}
        />
        <StatCard
          label="Max Stay"
          value={
            hospital?.maxStay != null ? `${hospital.maxStay}m` : '--'
          }
          sub={avgMaxStay7d != null ? `7d avg: ${Math.round(avgMaxStay7d)}m` : ''}
        />
        <StatCard
          label="Alerts (7d)"
          value={alerts7d.toString()}
          color={alerts7d > 0 ? '#ef4444' : undefined}
        />
      </div>

      {/* Time range toggles */}
      <div className="flex items-center gap-2">
        <span className="section-label">Census History</span>
        <div className="flex gap-1 ml-auto">
          {[
            { label: '24h', value: 24 },
            { label: '3d', value: 72 },
            { label: '7d', value: 168 },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTimeRange(opt.value)}
              className={`px-2 py-0.5 text-[10px] rounded ${
                timeRange === opt.value
                  ? 'bg-accent text-white'
                  : 'bg-elevated text-text-secondary hover:text-text-primary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Census chart */}
      {loading ? (
        <div className="h-[200px] flex items-center justify-center text-text-muted text-[11px]">
          Loading...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-text-muted text-[11px]">
          No historical data available
        </div>
      ) : (
        <div className="h-[200px] bg-elevated rounded p-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <defs>
                <linearGradient id="censusGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={{ fill: '#4b5563', fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: '#252840' }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[1, 4]}
                ticks={[1, 2, 3, 4]}
                tick={{ fill: '#4b5563', fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: '#252840' }}
                width={20}
              />
              <ReferenceLine y={2} stroke="#252840" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="maxCensus"
                stroke="none"
                fill="url(#censusGrad)"
                fillOpacity={1}
              />
              <Area
                type="monotone"
                dataKey="avgCensus"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="none"
                dot={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#12141f',
                  border: '1px solid #252840',
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelStyle={{ color: '#8892a8' }}
                formatter={(value: number, name: string) => [
                  value.toFixed(1),
                  name === 'avgCensus' ? 'Avg Census' : 'Max Census',
                ]}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* EMS Units chart */}
      {chartData.length > 0 && (
        <>
          <div className="section-label">EMS Units History</div>
          <div className="h-[200px] bg-elevated rounded p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
                <defs>
                  <linearGradient id="unitsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#4b5563', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: '#252840' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#4b5563', fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: '#252840' }}
                  width={20}
                />
                <Area
                  type="monotone"
                  dataKey="maxUnits"
                  stroke="none"
                  fill="url(#unitsGrad)"
                  fillOpacity={1}
                />
                <Area
                  type="monotone"
                  dataKey="avgUnits"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="none"
                  dot={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#12141f',
                    border: '1px solid #252840',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: '#8892a8' }}
                  formatter={(value: number, name: string) => [
                    value.toFixed(1),
                    name === 'avgUnits' ? 'Avg Units' : 'Max Units',
                  ]}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-elevated rounded p-2">
      <div className="text-[10px] text-text-secondary uppercase tracking-wider">{label}</div>
      <div className="text-[16px] font-bold mono" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
