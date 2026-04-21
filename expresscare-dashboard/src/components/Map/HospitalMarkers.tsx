import { CircleMarker, Popup, Tooltip } from 'react-leaflet';
import type { NormalizedHospital } from '../../types/edas';

const CENSUS_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#eab308',
  3: '#f97316',
  4: '#ef4444',
};

const UNKNOWN_COLOR = '#9ca3af';

const CENSUS_LABELS: Record<number, string> = {
  1: 'Normal (0-75%)',
  2: 'Advisory (76-100%)',
  3: 'Alert (101-130%)',
  4: 'Overcapacity (131%+)',
};

const SYSTEM_COLORS: Record<string, string> = {
  LifeBridge: '#3b82f6',
  'Johns Hopkins': '#8b5cf6',
  UMMS: '#ec4899',
  MedStar: '#f59e0b',
  Other: '#6b7280',
};

interface Props {
  hospitals: NormalizedHospital[];
  onSelect: (code: string) => void;
}

export default function HospitalMarkers({ hospitals, onSelect }: Props) {
  return (
    <>
      {hospitals.map((h) => {
        const scoreMissing = h.edCensusScore == null;
        const censusColor = scoreMissing
          ? UNKNOWN_COLOR
          : CENSUS_COLORS[h.edCensusScore!] ?? UNKNOWN_COLOR;
        const radius = 8 + 2 * h.numUnits;

        return (
          <CircleMarker
            key={h.code}
            center={[h.lat, h.lon]}
            radius={radius}
            pathOptions={{
              fillColor: censusColor,
              fillOpacity: 0.8,
              color: h.system === 'LifeBridge' ? '#3b82f6' : censusColor,
              weight: h.system === 'LifeBridge' ? 3 : 1.5,
              opacity: 1,
            }}
            eventHandlers={{
              click: () => onSelect(h.code),
            }}
          >
            {scoreMissing && (
              <Tooltip direction="top" offset={[0, -4]} opacity={0.9}>
                Census status unavailable
              </Tooltip>
            )}
            <Popup>
              <div className="min-w-[200px]">
                <div className="font-bold text-[13px]">{h.name}</div>
                <div className="text-[11px] mt-0.5" style={{ color: SYSTEM_COLORS[h.system] }}>
                  {h.system}
                </div>
                <div className="mt-2 space-y-1 text-[11px] mono">
                  <div>
                    Census:{' '}
                    <span style={{ color: censusColor }}>
                      {scoreMissing
                        ? 'unavailable'
                        : `${h.edCensusScore} ${CENSUS_LABELS[h.edCensusScore!] ?? ''}`}
                    </span>
                  </div>
                  <div>EMS Units: {h.numUnits} (enroute: {h.numUnitsEnroute})</div>
                  <div>Stay: {h.minStay ?? '—'}–{h.maxStay ?? '—'} min (avg: {h.meanStay?.toFixed(0) ?? '—'})</div>
                  {h.hasActiveAlert && (
                    <div className="text-census-4 font-bold">
                      ACTIVE ALERT
                      {h.alerts.yellow && ' [YELLOW]'}
                      {h.alerts.red && ' [RED]'}
                      {h.alerts.reroute && ' [REROUTE]'}
                      {h.alerts.codeBlack && ' [CODE BLACK]'}
                      {h.alerts.traumaBypass && ' [TRAUMA BYPASS]'}
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
