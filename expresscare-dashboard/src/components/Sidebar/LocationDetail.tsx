import { useEffect, useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import type { NormalizedHospital } from '../../types/edas';

interface ECLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  county: string;
  lat: number;
  lng: number;
  hasChildrensUrgentCare: boolean;
}

interface NearbyTract {
  geoid: string;
  total_population?: number;
  uninsured_rate?: number;
  places_measures?: { diabetes?: number };
  svi_themes?: { rpl_themes?: number };
}

interface Props {
  locations: ECLocation[];
  hospitals: NormalizedHospital[];
}

export default function LocationDetail({ locations, hospitals }: Props) {
  const selectedId = useDashboardStore((s) => s.selectedExpressCare);
  const selectExpressCare = useDashboardStore((s) => s.selectExpressCare);
  const [nearbyData, setNearbyData] = useState<NearbyTract[] | null>(null);

  const location = locations.find((l) => l.id === selectedId);

  useEffect(() => {
    if (!location) {
      setNearbyData(null);
      return;
    }

    const apiKey = import.meta.env.VITE_GEOHEALTH_API_KEY;
    if (!apiKey) return;

    fetch(
      `https://geohealth-api-production.up.railway.app/v1/nearby?lat=${location.lat}&lng=${location.lng}&radius=5&limit=50`,
      { headers: { 'X-API-Key': apiKey } },
    )
      .then((r) => r.json())
      .then((data: { tracts?: NearbyTract[] }) => setNearbyData(data.tracts ?? []))
      .catch((err) => console.error('[LocationDetail] nearby fetch failed:', err));
  }, [location]);

  if (!location) return null;

  // Compute catchment stats. Distinguish "no nearby tracts available" from "real zero":
  // if nearbyData itself is missing/empty, the catchment population is unavailable, not zero.
  // For individual tracts with a null total_population, skip them and report the skipped count.
  const hasNearby = nearbyData != null && nearbyData.length > 0;
  const tractsWithPop = hasNearby
    ? nearbyData!.filter((t) => t.total_population != null)
    : [];
  const skippedPopTracts = hasNearby ? nearbyData!.length - tractsWithPop.length : 0;
  const catchmentPop = hasNearby && tractsWithPop.length > 0
    ? tractsWithPop.reduce((s, t) => s + (t.total_population ?? 0), 0)
    : null;

  const avgUninsured = nearbyData && nearbyData.length > 0
    ? nearbyData.reduce((s, t) => s + (t.uninsured_rate ?? 0), 0) / nearbyData.length
    : null;
  const avgDiabetes = nearbyData && nearbyData.length > 0
    ? nearbyData.reduce((s, t) => s + (t.places_measures?.diabetes ?? 0), 0) / nearbyData.length
    : null;
  const avgSVI = nearbyData && nearbyData.length > 0
    ? nearbyData.reduce((s, t) => s + (t.svi_themes?.rpl_themes ?? 0), 0) / nearbyData.length
    : null;

  // Find nearest hospital
  const nearestHosp = hospitals
    .map((h) => {
      const d = Math.sqrt(
        (h.lat - location.lat) ** 2 + (h.lon - location.lng) ** 2,
      ) * 69; // rough miles
      return { ...h, distMi: d };
    })
    .sort((a, b) => a.distMi - b.distMi)[0];

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="section-label">Location Detail</div>
        <button
          onClick={() => selectExpressCare(null)}
          className="text-[10px] text-text-secondary hover:text-text-primary"
        >
          ✕ close
        </button>
      </div>
      <div className="bg-elevated rounded p-3 space-y-2">
        <div className="font-bold text-[13px]">{location.name}</div>
        <div className="text-[11px] text-text-secondary">
          {location.address}, {location.city} · {location.county}
        </div>
        {location.hasChildrensUrgentCare && (
          <div className="text-accent text-[11px] font-bold">+ Children&apos;s Urgent Care</div>
        )}

        {nearbyData === null ? (
          <div className="text-[11px] text-text-muted">Loading catchment data…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <MiniStat
                label="Catchment Pop"
                value={catchmentPop != null ? catchmentPop.toLocaleString() : 'unavailable'}
              />
              <MiniStat label="Uninsured %" value={avgUninsured != null ? `${avgUninsured.toFixed(1)}%` : '—'} />
              <MiniStat label="Diabetes %" value={avgDiabetes != null ? `${avgDiabetes.toFixed(1)}%` : '—'} />
              <MiniStat label="Mean SVI" value={avgSVI != null ? avgSVI.toFixed(2) : '—'} />
            </div>
            {skippedPopTracts > 0 && (
              <div className="text-[9px] text-text-muted mt-1">
                {skippedPopTracts} tract{skippedPopTracts === 1 ? '' : 's'} skipped (missing population)
              </div>
            )}
          </>
        )}

        {nearestHosp && (
          <div className="text-[11px] mt-2 border-t border-border pt-2">
            <span className="text-text-secondary">Nearest ED: </span>
            <span className="text-text-primary">
              {nearestHosp.name.replace(/\s*-\s*\d+$/, '')}
            </span>
            <span className="text-text-secondary"> ({nearestHosp.distMi.toFixed(1)}mi)</span>
            <span className="ml-1 mono" style={{
              color: nearestHosp.edCensusScore === 1 ? '#22c55e' :
                nearestHosp.edCensusScore === 2 ? '#eab308' :
                nearestHosp.edCensusScore === 3 ? '#f97316' :
                nearestHosp.edCensusScore === 4 ? '#ef4444' : '#6b7280',
            }}>
              Level {nearestHosp.edCensusScore ?? '—'}
            </span>
          </div>
        )}

        <div className="text-[10px] text-text-muted mt-2 border-t border-border pt-2">
          Overflow forecast: placeholder — see Phase 2
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-text-muted uppercase">{label}</div>
      <div className="text-[13px] font-bold mono">{value}</div>
    </div>
  );
}
