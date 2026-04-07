import { CircleMarker, Popup } from 'react-leaflet';

interface CompetitorLocation {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
}

interface Props {
  locations: CompetitorLocation[];
}

export default function CompetitorMarkers({ locations }: Props) {
  return (
    <>
      {locations.map((loc) => (
        <CircleMarker
          key={loc.id}
          center={[loc.lat, loc.lng]}
          radius={5}
          pathOptions={{
            fillColor: '#4b5563',
            fillOpacity: 0.7,
            color: '#374151',
            weight: 1,
            opacity: 0.8,
          }}
        >
          <Popup>
            <div>
              <div className="font-bold text-[12px]">{loc.name}</div>
              <div className="text-[11px] text-text-secondary">{loc.brand}</div>
              <div className="text-[11px] text-text-secondary">
                {loc.address}, {loc.city}
              </div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
