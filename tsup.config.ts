import { defineConfig } from 'tsup';

// Three entry points, one per subpath export (ADR-0005). They are built as
// separate chunks so that a consumer importing only `comparanda` never pulls in
// view code -- a condition ADR-0005 makes a requirement of its own acceptance.
// `scripts/check-boundaries.ts` is what actually verifies it.
//
// `clean` is off in every config: they build concurrently into one `dist/`, and
// a clean in one would delete another's output. `pnpm build` empties `dist/`
// first instead.
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'view/index': 'src/view/index.ts',
      'store/index': 'src/store/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    treeshake: true,
    splitting: true,
    // Emitted so `scripts/check-boundaries.ts` can read which inputs actually
    // landed in the core bundle. Without it that check silently passes, which is
    // worse than not having it. Only this config writes one.
    metafile: true,
  },
  // `comparanda/build` (ADR-0017 clause 6): Node only, with its peers external.
  {
    entry: { 'build/index': 'src/build/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    dts: true,
    clean: false,
    sourcemap: true,
    // `import.meta.url` in the CommonJS build, which finds the standalone entry.
    shims: true,
    external: ['vite', 'vite-plugin-singlefile'],
  },
  // The `comparanda` command.
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    clean: false,
    external: ['vite', 'vite-plugin-singlefile'],
  },
  // The standalone page's entry: one browser module with every dependency in
  // it, which `comparanda build` hands to Vite to inline into the HTML.
  {
    entry: { 'standalone/main': 'src/standalone/main.ts' },
    format: ['esm'],
    platform: 'browser',
    clean: false,
    splitting: false,
    noExternal: [/.*/],
  },
]);
