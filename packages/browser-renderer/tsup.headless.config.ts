import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/headless.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  noExternal: [
    '@uniscenarios/city-renderer',
    '@uniscenarios/playback',
    '@uniscenarios/render-runtime',
    '@uniscenarios/scenario-model',
    'fflate',
    'three',
  ],
});
