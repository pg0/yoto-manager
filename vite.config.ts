import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Static SPA, no backend. The app talks to api.yotoplay.com directly (CORS is
// open on every endpoint it uses), so there is nothing to proxy in dev either -
// dev and prod behave identically.
export default defineConfig({
  plugins: [react()],
  // relative asset URLs so the build also works from a subfolder on plain webspace
  base: './',
  test: {
    // pure logic tests (publish payload, store reducers) - no DOM needed,
    // setup.ts supplies the storage globals the modules touch on import
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 so a phone on the same LAN can reach it
  },
});
