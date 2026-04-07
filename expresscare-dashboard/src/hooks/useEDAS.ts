import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizedHospital } from '../types/edas';
import { fetchFacilities, fetchHospitalStatus } from '../services/edas';
import { normalizeHospitals } from '../services/edas-normalize';

const POLL_MS = Number(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_EDAS_POLL_INTERVAL_MS) || 60000,
);

interface UseEdasResult {
  hospitals: NormalizedHospital[];
  previousHospitals: NormalizedHospital[];
  lastUpdated: number | null;
  isLive: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEDAS(): UseEdasResult {
  const [hospitals, setHospitals] = useState<NormalizedHospital[]>([]);
  const [previousHospitals, setPreviousHospitals] = useState<NormalizedHospital[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const [statusEnvelope, facilities] = await Promise.all([
        fetchHospitalStatus(controller.signal),
        fetchFacilities(controller.signal),
      ]);
      const normalized = normalizeHospitals(statusEnvelope, facilities);

      setHospitals((prev) => {
        setPreviousHospitals(prev);
        return normalized;
      });
      setLastUpdated(Date.now());
      setIsLive(true);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[useEDAS] poll failed:', err);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [poll]);

  return { hospitals, previousHospitals, lastUpdated, isLive, error, refetch: poll };
}
