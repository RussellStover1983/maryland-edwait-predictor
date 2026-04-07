import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { useDashboardStore } from '../../store/dashboardStore';
import { placeholderForecast, getHospitalBaseline } from '../../services/predictor';
import type { NormalizedHospital } from '../../types/edas';

interface Props {
  hospitals: NormalizedHospital[];
}

export default function ForecastChart({ hospitals }: Props) {
  const selectedHospital = useDashboardStore((s) => s.selectedHospital);
  const hospital = hospitals.find((h) => h.code === selectedHospital);

  const chartData = useMemo(() => {
    if (!hospital) return null;

    const currentScore = hospital.edCensusScore ?? 2;
    const currentHour = new Date().getHours();
    const baseline = getHospitalBaseline(hospital.code);
    const forecast = placeholderForecast(currentScore, currentHour, baseline);

    return forecast.p50.map((p50, i) => {
      const hoursAhead = i * 0.5;
      const time = new Date();
      time.setMinutes(time.getMinutes() + hoursAhead * 60);

      return {
        time: time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        hoursAhead,
        p10: forecast.p10[i],
        p50,
        p90: forecast.p90[i],
        isCurrent: i === 0,
      };
    });
  }, [hospital]);

  if (!hospital || !chartData) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-[12px]">
        Select a hospital to view forecast
      </div>
    );
  }

  const maxCallout = chartData.reduce((max, d) => d.p50 > max.p50 ? d : max, chartData[0]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-2">
        <div>
          <span className="section-label">24h Forecast</span>
          <span className="text-[11px] text-text-secondary ml-2">
            {hospital.name.replace(/\s*-\s*\d+$/, '')}
          </span>
        </div>
        <span className="text-[9px] text-text-muted bg-elevated px-2 py-0.5 rounded">
          PLACEHOLDER MODEL
        </span>
      </div>

      <div className="flex-1 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
            <defs>
              <linearGradient id="bandGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="time"
              tick={{ fill: '#4b5563', fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: '#252840' }}
              interval={7}
            />
            <YAxis
              domain={[1, 4]}
              ticks={[1, 2, 3, 4]}
              tick={{ fill: '#4b5563', fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: '#252840' }}
              width={20}
            />

            <ReferenceLine y={2} stroke="#252840" strokeDasharray="3 3" label="" />

            <Area
              type="monotone"
              dataKey="p90"
              stroke="none"
              fill="url(#bandGradient)"
              fillOpacity={1}
            />
            <Area
              type="monotone"
              dataKey="p10"
              stroke="none"
              fill="#0a0b10"
              fillOpacity={1}
            />
            <Area
              type="monotone"
              dataKey="p50"
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
                name === 'p50' ? 'Forecast' : name === 'p10' ? 'Low' : 'High',
              ]}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="px-4 pb-2 text-[10px] text-text-secondary">
        Peak expected at {maxCallout.time} (Level {maxCallout.p50.toFixed(1)}).
        Current: Level {hospital.edCensusScore ?? '—'}.
        {(hospital.edCensusScore ?? 2) >= 3 && ' Expect gradual decline toward baseline.'}
      </div>
    </div>
  );
}
