import { useEffect, useState } from 'react';
import { useEDAS } from './hooks/useEDAS';
import { useDashboardStore } from './store/dashboardStore';
import MapContainer from './components/Map/MapContainer';
import { HexGridWithBoundaries } from './components/Map/HexGrid';
import HospitalMarkers from './components/Map/HospitalMarkers';
import ExpressCareMarkers from './components/Map/ExpressCareMarkers';
import CompetitorMarkers from './components/Map/CompetitorMarkers';
import CoverageGapZones from './components/Map/CoverageGapZones';
import LiveStatus from './components/Sidebar/LiveStatus';
import StatewideSummary from './components/Sidebar/StatewideSummary';
import ExpansionOpportunities from './components/Sidebar/ExpansionOpportunities';
import LocationDetail from './components/Sidebar/LocationDetail';
import LayerPanel from './components/Controls/LayerPanel';
import TimeBar from './components/TimeControls/TimeBar';
import ForecastChart from './components/Timeline/ForecastChart';

interface HexBaseScore {
  h3Index: string;
  baseScore: number;
  components: { healthBurden: number; socialVulnerability: number; coverageGap: number; populationDensity: number };
  tractGeoid: string;
  population: number;
  nearestExpressCare: { id: string; name: string; distanceMiles: number };
}

interface HexCell {
  h3Index: string;
  centroid: { lat: number; lng: number };
  boundary: Array<{ lat: number; lng: number }>;
}

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

interface CompetitorLocation {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
}

export default function App() {
  const { hospitals, previousHospitals, lastUpdated, isLive, error } = useEDAS();
  const { layers, selectHospital } = useDashboardStore();

  const [hexScores, setHexScores] = useState<HexBaseScore[]>([]);
  const [hexGrid, setHexGrid] = useState<HexCell[]>([]);
  const [ecLocations, setEcLocations] = useState<ECLocation[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorLocation[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/data/hex-base-scores.json').then((r) => r.json()),
      fetch('/data/expresscare-locations.json').then((r) => r.json()),
      fetch('/data/competitor-locations.json').then((r) => r.json()),
    ]).then(([scores, ec, comp]) => {
      setHexScores(scores);
      setEcLocations(ec);
      setCompetitors(comp);
    }).catch((err) => console.error('[App] Failed to load static data:', err));

    // hex-grid.json is large; load separately
    fetch('/data/hex-grid.json')
      .then((r) => r.json())
      .then(setHexGrid)
      .catch((err) => console.error('[App] Failed to load hex grid:', err));
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text-primary">
      {/* Sidebar — 360px */}
      <aside className="w-[360px] flex-shrink-0 border-r border-border bg-panel flex flex-col">
        <header className="p-4 border-b border-border">
          <div className="text-[12px] font-bold tracking-widest text-accent">EXPRESSCARE</div>
          <div className="text-[20px] font-bold text-text-primary leading-tight">
            Intelligence Grid
          </div>
          <div className="mt-1 h-[2px] w-10 bg-accent" />
          <div className="mt-2 text-[10px] text-text-secondary">Powered by GeoHealth API</div>
          <div className="mt-2 flex items-center gap-2 text-[10px] mono">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isLive ? 'bg-live animate-pulse-dot' : 'bg-text-muted'
              }`}
            />
            <span className="text-text-secondary">
              {isLive ? 'EDAS LIVE' : 'CONNECTING…'}
              {lastUpdated && ` · Updated ${Math.round((Date.now() - lastUpdated) / 1000)}s ago`}
            </span>
          </div>
          {error && (
            <div className="mt-1 text-[10px] text-census-4">EDAS error: {error}</div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <StatewideSummary hospitals={hospitals} hexScores={hexScores} />
          <LiveStatus hospitals={hospitals} previousHospitals={previousHospitals} />
          <ExpansionOpportunities hexScores={hexScores} hexGrid={hexGrid} />
          <LocationDetail locations={ecLocations} hospitals={hospitals} />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col relative">
        {/* Map area */}
        <div className="flex-1 relative">
          <MapContainer>
            {layers.heatmap && hexGrid.length > 0 && (
              <HexGridWithBoundaries hexScores={hexScores} hexGrid={hexGrid} />
            )}
            {layers.hospitals && (
              <HospitalMarkers hospitals={hospitals} onSelect={selectHospital} />
            )}
            {layers.expresscare && (
              <ExpressCareMarkers locations={ecLocations} />
            )}
            {layers.competitors && (
              <CompetitorMarkers locations={competitors} />
            )}
            {layers.coverageGaps && hexGrid.length > 0 && (
              <CoverageGapZones hexScores={hexScores} hexGrid={hexGrid} />
            )}
          </MapContainer>

          {/* Overlays */}
          <TimeBar />
          <LayerPanel />
        </div>

        {/* Forecast panel — 220px */}
        <div className="h-[220px] flex-shrink-0 border-t border-border bg-panel">
          <ForecastChart hospitals={hospitals} />
        </div>
      </div>
    </div>
  );
}
