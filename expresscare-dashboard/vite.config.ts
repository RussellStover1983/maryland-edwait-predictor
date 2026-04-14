import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-middleware',
      configureServer(server) {
        import('./server/api').then(({ setupApiMiddleware }) => {
          setupApiMiddleware(server);
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api/edas': {
        target: 'https://edas.miemss.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/edas/, '/edas-services/api'),
      },
    },
  },
});
