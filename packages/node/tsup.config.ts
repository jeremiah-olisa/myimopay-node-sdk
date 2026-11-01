import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

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
  define: { __MYIMOPAY_VERSION__: JSON.stringify(version) },
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
