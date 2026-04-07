import { CircleMarker, Popup } from 'react-leaflet';
import { useDashboardStore } from '../../store/dashboardStore';

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

interface Props {
  locations: ECLocation[];
}

export default function ExpressCareMarkers({ locations }: Props) {
  const selectExpressCare = useDashboardStore((s) => s.selectExpressCare);

  return (
    <>
      {locations.map((loc) => (
        <CircleMarker
          key={loc.id}
          center={[loc.lat, loc.lng]}
          radius={7}
          pathOptions={{
            fillColor: '#3b82f6',
            fillOpacity: 0.9,
            color: '#1d4ed8',
            weight: 2,
            opacity: 1,
          }}
          eventHandlers={{
            click: () => selectExpressCare(loc.id),
          }}
        >
          <Popup>
            <div className="min-w-[180px]">
              <div className="font-bold text-[13px]">{loc.name}</div>
              <div className="text-[11px] text-text-secondary mt-0.5">
                {loc.address}, {loc.city}
              </div>
              <div className="text-[11px] text-text-secondary">{loc.county}</div>
              {loc.hasChildrensUrgentCare && (
                <div className="text-accent text-[11px] font-bold mt-1">+ Children&apos;s Urgent Care</div>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
