/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vite.config.js';

/**
 * Vitest configuration.
 *
 * Merges with vite.config.js so the `@` alias and other resolve settings
 * apply to tests. Adds a single global setup file that installs a minimal
 * `window` mock BEFORE any test module imports execute — required because
 * `src/config/api.js` reads `window.location.origin` at import time.
 *
 * No jsdom dependency. Environment is node (default).
 */
export default mergeConfig(
  baseConfig as any,
  defineConfig({
    test: {
      environment: 'node',
      setupFiles: ['./src/tests/setup.ts'],
      include: ['src/**/*.test.ts'],
    },
  })
);
