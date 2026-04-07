import { MapContainer as LeafletMapContainer, TileLayer } from 'react-leaflet';
import { useDashboardStore } from '../../store/dashboardStore';
import 'leaflet/dist/leaflet.css';

interface Props {
  children?: React.ReactNode;
}

export default function MapContainer({ children }: Props) {
  const { viewport } = useDashboardStore();

  return (
    <LeafletMapContainer
      center={[viewport.lat, viewport.lng]}
      zoom={viewport.zoom}
      className="h-full w-full"
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
      />
      {children}
    </LeafletMapContainer>
  );
}
