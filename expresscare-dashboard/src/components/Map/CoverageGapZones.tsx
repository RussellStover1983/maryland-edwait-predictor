import { Polygon, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';

interface HexBaseScore {
  h3Index: string;
  baseScore: number;
  population: number;
  nearestExpressCare: { id: string; name: string; distanceMiles: number };
}

interface HexCell {
  h3Index: string;
  boundary: Array<{ lat: number; lng: number }>;
}

interface Props {
  hexScores: HexBaseScore[];
  hexGrid: HexCell[];
}

export default function CoverageGapZones({ hexScores, hexGrid }: Props) {
  const boundaryMap = new Map(hexGrid.map((h) => [h.h3Index, h.boundary]));

  const gaps = hexScores.filter(
    (h) => h.baseScore > 65 && h.nearestExpressCare.distanceMiles > 8,
  );

  return (
    <>
      {gaps.map((hex) => {
        const boundary = boundaryMap.get(hex.h3Index);
        if (!boundary || boundary.length === 0) return null;

        const positions: LatLngExpression[] = boundary.map((p) => [p.lat, p.lng]);

        return (
          <Polygon
            key={hex.h3Index}
            positions={positions}
            pathOptions={{
              fillColor: '#f59e0b',
              fillOpacity: 0.3,
              color: '#f59e0b',
              weight: 2,
              opacity: 0.7,
              dashArray: '6 4',
            }}
            className="animate-gap-pulse"
          >
            <Tooltip>
              <div className="text-[11px]">
                <div className="font-bold text-gap">Coverage Gap</div>
                <div>Score: {hex.baseScore} | Pop: {hex.population.toLocaleString()}</div>
                <div>Nearest EC: {hex.nearestExpressCare.name} ({hex.nearestExpressCare.distanceMiles}mi)</div>
              </div>
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
}
