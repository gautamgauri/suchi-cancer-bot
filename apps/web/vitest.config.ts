import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/__tests__/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Bound the worker pool for the same reason as apps/api/jest.config.js:
    // one worker per core (16 here) plus a jsdom environment each exhausts the
    // WSL2 memory cap, and the kernel OOM-killer kills node rather than the
    // runner failing cleanly. Both pools are set so the bound holds whichever
    // one vitest picks.
    poolOptions: {
      threads: { minThreads: 1, maxThreads: 4 },
      forks: { minForks: 1, maxForks: 4 },
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/components/**/*.tsx', 'src/utils/**/*.ts'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**']
    }
  }
});
