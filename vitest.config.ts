import { defineConfig } from 'vitest/config';

// Vitest covers plain TypeScript logic in src/ (no React Native runtime).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
