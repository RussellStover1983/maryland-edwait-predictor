import { useEffect, useState } from 'react';

export interface GravityExpansionOpportunity {
  rank: number;
  h3Index: string;
  centroid: { lat: number; lng: number };
  base_score: number;
  captured_daily_avg: number;
  captured_by_period: {
    morning: number;
    afternoon: number;
    evening: number;
    overnight: number;
  };
  captured_from: Array<{
    hospital: string;
    code: string;
    daily_lost: number;
  }>;
  nearest_expresscare_miles: number;
  nearby_population_5mi: number;
  divertible_pct_used: number;
}

export interface GravityResults {
  computed_at: string;
  config: {
    divertible_pct: number;
    beta: number;
    max_drive_minutes: number;
    expresscare_attractiveness: number;
    competitor_attractiveness: number;
  };
  statewide: {
    total_outpatient_monthly: number;
    total_divertible_monthly: number;
    total_divertible_daily: number;
    calibration_factor_median: number;
  };
  hex_demand: Record<string, {
    monthly_demand: number;
    divertible_daily: number;
    primary_hospital: string;
    primary_hospital_prob: number;
  }>;
  facility_capture: Record<string, {
    daily_avg: number;
    name: string;
  }>;
  expansion_opportunities: GravityExpansionOpportunity[];
}

export function useGravityResults() {
  const [data, setData] = useState<GravityResults | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = import.meta.env.DEV
      ? '/data/gravity-results.json'
      : '/api/model/gravity_results';
    fetch(url)
      .then((r) => r.json())
      .then(setData)
      .catch((err) => console.error('[gravity] Failed to load:', err))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}
