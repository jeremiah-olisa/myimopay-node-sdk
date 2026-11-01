import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'browser-guard': 'src/guard.browser.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  treeshake: true,
  splitting: false,
  tsconfig: '../../tsconfig.json',
  noExternal: ['@myimopay/core'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
