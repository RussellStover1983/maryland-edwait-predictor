import { Polygon, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';

interface HexBaseScore {
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

function scoreToColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100));
  if (t < 0.5) {
    const r = Math.round(34 + (234 - 34) * (t * 2));
    const g = Math.round(197 + (179 - 197) * (t * 2));
    const b = Math.round(94 + (8 - 94) * (t * 2));
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(234 + (239 - 234) * ((t - 0.5) * 2));
  const g = Math.round(179 + (68 - 179) * ((t - 0.5) * 2));
  const b = Math.round(8 + (68 - 8) * ((t - 0.5) * 2));
  return `rgb(${r},${g},${b})`;
}

export function HexGridWithBoundaries({ hexScores, hexGrid }: {
  hexScores: HexBaseScore[];
  hexGrid: Array<{ h3Index: string; boundary: Array<{ lat: number; lng: number }> }>;
}) {
  const boundaryMap = new Map(hexGrid.map((h) => [h.h3Index, h.boundary]));

  return (
    <>
      {hexScores.map((hex) => {
        const boundary = boundaryMap.get(hex.h3Index);
        if (!boundary || boundary.length === 0) return null;

        const positions: LatLngExpression[] = boundary.map((p) => [p.lat, p.lng]);

        return (
          <Polygon
            key={hex.h3Index}
            positions={positions}
            pathOptions={{
              fillColor: scoreToColor(hex.baseScore),
              fillOpacity: 0.35,
              color: scoreToColor(hex.baseScore),
              weight: 1,
              opacity: 0.5,
            }}
          >
            <Tooltip>
              <div className="text-[11px]">
                <div className="font-bold">Score: {hex.baseScore}</div>
                <div>Pop: {hex.population.toLocaleString()}</div>
                <div>Nearest EC: {hex.nearestExpressCare.name} ({hex.nearestExpressCare.distanceMiles}mi)</div>
                <div className="text-text-secondary mt-1">
                  Health: {(hex.components.healthBurden * 100).toFixed(0)} |
                  SVI: {(hex.components.socialVulnerability * 100).toFixed(0)} |
                  Gap: {(hex.components.coverageGap * 100).toFixed(0)} |
                  Pop: {(hex.components.populationDensity * 100).toFixed(0)}
                </div>
              </div>
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
}
