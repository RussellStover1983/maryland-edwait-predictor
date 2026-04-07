import { useDashboardStore } from '../../store/dashboardStore';

const LAYER_LABELS: Record<string, string> = {
  heatmap: 'Demand Heatmap',
  hospitals: 'ED Hospitals',
  expresscare: 'ExpressCare',
  competitors: 'Competitors',
  coverageGaps: 'Coverage Gaps',
  sviChoropleth: 'SVI Choropleth',
};

export default function LayerPanel() {
  const { layers, toggleLayer } = useDashboardStore();

  return (
    <div className="absolute top-4 right-4 z-[1000] w-[220px] bg-panel border border-border rounded-lg p-3 shadow-lg">
      <div className="section-label mb-2">Layers</div>
      <div className="space-y-1.5">
        {(Object.keys(layers) as Array<keyof typeof layers>).map((key) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer group">
            <div
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                layers[key]
                  ? 'bg-accent border-accent'
                  : 'border-border group-hover:border-text-secondary'
              }`}
              onClick={() => toggleLayer(key)}
            >
              {layers[key] && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span
              className="text-[11px] text-text-secondary group-hover:text-text-primary transition-colors"
              onClick={() => toggleLayer(key)}
            >
              {LAYER_LABELS[key]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
