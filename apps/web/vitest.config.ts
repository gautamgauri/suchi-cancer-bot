import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/__tests__/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/components/**/*.tsx', 'src/utils/**/*.ts'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**']
    }
  }
});
