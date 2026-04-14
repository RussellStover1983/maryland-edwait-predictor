import { useEffect, useRef, useState, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import { Deck, MapView } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { useDashboardStore } from '../../store/dashboardStore';

interface HexScore {
  h3Index: string;
  baseScore: number;
  components: {
    healthBurden: number;
    socialVulnerability: number;
    coverageGap: number;
    populationDensity: number;
  };
  tractGeoid: string;
  population: number;
  nearestExpressCare: { id: string; name: string; distanceMiles: number };
}

export type HexMode = 'heatmap' | 'coverageGaps' | 'sviChoropleth';

interface Props {
  hexScores: HexScore[];
  mode: HexMode;
}

interface TooltipData {
  x: number;
  y: number;
  score: number;
  pop: number;
  nearest: { name: string; distanceMiles: number };
  components: HexScore['components'];
  svi: number;
}

function scoreToRGBA(score: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, score / 100));
  if (t < 0.5) {
    const r = Math.round(34 + (234 - 34) * (t * 2));
    const g = Math.round(197 + (179 - 197) * (t * 2));
    const b = Math.round(94 + (8 - 94) * (t * 2));
    return [r, g, b, 90];
  }
  const r = Math.round(234 + (239 - 234) * ((t - 0.5) * 2));
  const g = Math.round(179 + (68 - 179) * ((t - 0.5) * 2));
  const b = Math.round(8 + (68 - 8) * ((t - 0.5) * 2));
  return [r, g, b, 90];
}

function sviToRGBA(svi: number): [number, number, number, number] {
  // Blue (low vulnerability) → Purple → Red (high vulnerability)
  const t = Math.max(0, Math.min(1, svi));
  if (t < 0.5) {
    const r = Math.round(59 + (147 - 59) * (t * 2));
    const g = Math.round(130 + (51 - 130) * (t * 2));
    const b = Math.round(246 + (234 - 246) * (t * 2));
    return [r, g, b, 110];
  }
  const r = Math.round(147 + (239 - 147) * ((t - 0.5) * 2));
  const g = Math.round(51 + (68 - 51) * ((t - 0.5) * 2));
  const b = Math.round(234 + (68 - 234) * ((t - 0.5) * 2));
  return [r, g, b, 110];
}

const GAP_COLOR: [number, number, number, number] = [245, 158, 11, 115];

function getViewState(map: L.Map) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  return {
    longitude: center.lng,
    latitude: center.lat,
    zoom: zoom - 1,
    pitch: 0,
    bearing: 0,
  };
}

// Maryland state FIPS = "24"
function isMarylandHex(h: HexScore): boolean {
  return h.tractGeoid.startsWith('24');
}

export default function DeckHexLayer({ hexScores, mode }: Props) {
  const map = useMap();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deckRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const selectedHex = useDashboardStore((s) => s.selectedHex);

  const marylandOnly = hexScores.filter(isMarylandHex);

  const filteredData = (() => {
    switch (mode) {
      case 'coverageGaps':
        return marylandOnly.filter(
          (h) => h.baseScore > 65 && h.nearestExpressCare.distanceMiles > 8,
        );
      case 'sviChoropleth':
        return marylandOnly.filter((h) => h.components.socialVulnerability > 0);
      default:
        return marylandOnly;
    }
  })();

  const buildLayers = useCallback((data: HexScore[], layerMode: HexMode, highlightH3: string | null) => {
    const layers = [
      new H3HexagonLayer<HexScore>({
        id: 'hex-layer',
        data,
        getHexagon: (d: HexScore) => d.h3Index,
        getFillColor: (d: HexScore) => {
          switch (layerMode) {
            case 'coverageGaps':
              return GAP_COLOR;
            case 'sviChoropleth':
              return sviToRGBA(d.components.socialVulnerability);
            default:
              return scoreToRGBA(d.baseScore);
          }
        },
        extruded: false,
        filled: true,
        stroked: true,
        getLineColor: layerMode === 'coverageGaps' ? [245, 158, 11, 180] : [255, 255, 255, 20],
        lineWidthMinPixels: layerMode === 'coverageGaps' ? 1 : 0.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        opacity: layerMode === 'coverageGaps' ? 0.5 : 0.35,
        updateTriggers: {
          getFillColor: [layerMode],
          getLineColor: [layerMode],
        },
      }),
    ];

    // Bright highlight ring for the selected expansion opportunity hex
    if (highlightH3) {
      const selectedData = data.filter((d) => d.h3Index === highlightH3);
      if (selectedData.length > 0) {
        layers.push(
          new H3HexagonLayer<HexScore>({
            id: 'hex-highlight',
            data: selectedData,
            getHexagon: (d: HexScore) => d.h3Index,
            getFillColor: [59, 130, 246, 160],
            extruded: false,
            filled: true,
            stroked: true,
            getLineColor: [255, 255, 255, 255],
            lineWidthMinPixels: 4,
            opacity: 1,
          }),
        );
      }
    }

    return layers;
  }, []);

  // Initialize deck.gl
  useEffect(() => {
    const container = map.getContainer();

    const canvas = document.createElement('canvas');
    canvas.id = 'deck-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // pointer-events OFF — lets Leaflet markers receive clicks/hovers normally
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '450';
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const deck = new Deck({
      canvas,
      views: new MapView({ repeat: true }),
      initialViewState: getViewState(map),
      controller: false,
      layers: buildLayers(filteredData, mode, selectedHex),
    });
    deckRef.current = deck;

    // Manual hover picking via container mousemove (since canvas has pointer-events: none)
    const onMouseMove = (e: MouseEvent) => {
      if (!deckRef.current) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const info = deckRef.current.pickObject({ x, y, radius: 0 });
      if (info?.object) {
        const hex = info.object as HexScore;
        setTooltip({
          x,
          y,
          score: hex.baseScore,
          pop: hex.population,
          nearest: hex.nearestExpressCare,
          components: hex.components,
          svi: hex.components.socialVulnerability,
        });
      } else {
        setTooltip(null);
      }
    };

    const onMouseLeave = () => setTooltip(null);

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);

    // Sync view state on Leaflet move/zoom
    const syncView = () => {
      deck.setProps({ viewState: getViewState(map) });
    };
    map.on('move', syncView);
    map.on('zoom', syncView);
    map.on('resize', syncView);

    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
      map.off('move', syncView);
      map.off('zoom', syncView);
      map.off('resize', syncView);
      deck.finalize();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      deckRef.current = null;
      canvasRef.current = null;
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update layers when data or mode changes
  useEffect(() => {
    if (deckRef.current) {
      deckRef.current.setProps({ layers: buildLayers(filteredData, mode, selectedHex) });
    }
  }, [filteredData, mode, selectedHex, buildLayers]);

  if (!tooltip) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: tooltip.x + 12,
        top: tooltip.y - 12,
        zIndex: 1000,
        pointerEvents: 'none',
        backgroundColor: 'rgba(17, 17, 17, 0.92)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 4,
        padding: '6px 10px',
        fontSize: 11,
        color: '#e5e5e5',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ fontWeight: 'bold' }}>
        {mode === 'sviChoropleth'
          ? `SVI: ${(tooltip.svi * 100).toFixed(0)} / 100`
          : `Score: ${tooltip.score}`}
      </div>
      <div>Pop: {tooltip.pop.toLocaleString()}</div>
      <div>Nearest EC: {tooltip.nearest.name} ({tooltip.nearest.distanceMiles}mi)</div>
      <div style={{ color: '#999', marginTop: 2 }}>
        Health: {(tooltip.components.healthBurden * 100).toFixed(0)} |
        SVI: {(tooltip.components.socialVulnerability * 100).toFixed(0)} |
        Gap: {(tooltip.components.coverageGap * 100).toFixed(0)} |
        Pop: {(tooltip.components.populationDensity * 100).toFixed(0)}
      </div>
    </div>
  );
}
