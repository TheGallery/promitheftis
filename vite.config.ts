import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative, so the built game works from any path, including a GitHub Pages project site.
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
