import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: ['src/types.ts'],
    },
  },
  plugins: [
    {
      name: 'virtual-astro-strict-csp-config',
      resolveId(id) {
        if (id === 'virtual:astro-strict-csp/config') {
          return '\0virtual:astro-strict-csp/config';
        }
      },
      load(id) {
        if (id === '\0virtual:astro-strict-csp/config') {
          return 'export const ssrOptions = { reportOnly: false };';
        }
      },
    },
  ],
});
