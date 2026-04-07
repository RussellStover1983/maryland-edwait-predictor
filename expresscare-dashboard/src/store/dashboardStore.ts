import { create } from 'zustand';

interface DashboardState {
  viewport: { lat: number; lng: number; zoom: number };
  selectedHospital: string | null;
  selectedExpressCare: string | null;
  selectedHex: string | null;
  timelineOffsetHours: number;
  isPlaying: boolean;
  layers: {
    heatmap: boolean;
    hospitals: boolean;
    expresscare: boolean;
    competitors: boolean;
    coverageGaps: boolean;
    sviChoropleth: boolean;
  };
  setViewport: (vp: Partial<DashboardState['viewport']>) => void;
  selectHospital: (code: string | null) => void;
  selectExpressCare: (id: string | null) => void;
  selectHex: (h3: string | null) => void;
  setTimelineOffset: (hours: number) => void;
  setPlaying: (playing: boolean) => void;
  toggleLayer: (layer: keyof DashboardState['layers']) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  viewport: { lat: 39.29, lng: -76.61, zoom: 9 },
  selectedHospital: null,
  selectedExpressCare: null,
  selectedHex: null,
  timelineOffsetHours: 0,
  isPlaying: false,
  layers: {
    heatmap: true,
    hospitals: true,
    expresscare: true,
    competitors: false,
    coverageGaps: true,
    sviChoropleth: false,
  },
  setViewport: (vp) => set((s) => ({ viewport: { ...s.viewport, ...vp } })),
  selectHospital: (code) => set({ selectedHospital: code }),
  selectExpressCare: (id) => set({ selectedExpressCare: id }),
  selectHex: (h3) => set({ selectedHex: h3 }),
  setTimelineOffset: (hours) => set({ timelineOffsetHours: hours }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
}));
