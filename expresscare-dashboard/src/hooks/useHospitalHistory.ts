import { useState, useEffect, useCallback } from 'react';

export interface HospitalSummaryRow {
  hospital_code: string;
  hospital_name: string;
  snapshot_count: string;
  avg_census: string | null;
  max_census: number | null;
  avg_units: string | null;
  avg_max_stay: string | null;
  total_alert_snapshots: string;
  earliest: string;
  latest: string;
}

export interface HospitalTimeSeriesRow {
  hour: string;
  avg_census: string;
  max_census: number;
  avg_units: string;
  max_units: number;
  avg_max_stay: string | null;
  samples: string;
}

export interface HospitalStats {
  total_snapshots: string;
  hospital_count: string;
  earliest: string;
  latest: string;
}

export function useHospitalSummary() {
  const [data, setData] = useState<HospitalSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hospitals/summary');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: HospitalSummaryRow[] = await res.json();
      setData(rows);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}

export function useHospitalTimeSeries(code: string | null, hours: number) {
  const [data, setData] = useState<HospitalTimeSeriesRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setData([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/hospitals/${encodeURIComponent(code)}/history?hours=${hours}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rows: HospitalTimeSeriesRow[]) => {
        if (!cancelled) {
          setData(rows);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [code, hours]);

  return { data, loading, error };
}
