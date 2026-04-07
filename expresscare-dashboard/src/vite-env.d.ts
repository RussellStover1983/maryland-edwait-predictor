/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EDAS_BASE_URL?: string;
  readonly VITE_EDAS_POLL_INTERVAL_MS?: string;
  readonly VITE_GEOHEALTH_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
