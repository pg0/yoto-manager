import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the SPA runs on :5173 and proxies /api and /auth to the Node backend
// on :8787 (see server/). The app still works offline on mock data until you
// sign in via /auth/login.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/auth': 'http://127.0.0.1:8788',
    },
  },
});
