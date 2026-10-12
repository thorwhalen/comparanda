import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig, type Options } from 'tsup';

import { packageOf, PREBUNDLED_SUFFIX } from './src/build/budget.js';

/**
 * Beside the pre-bundled standalone entry, which packages are inside it and how
 * many bytes each contributes (#116). Vite sees that entry as one module, so
 * without this the byte budget would charge every dependency to comparanda and
 * a reservation would never lapse. Read from esbuild's metafile, which tsup
 * always asks for; written as our own file, so the core config's
 * `metafile-esm.json` is not overwritten.
 */
const packageManifest: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'comparanda-package-manifest',
  setup(build) {
    build.onEnd((result) => {
      for (const [out, { inputs }] of Object.entries(result.metafile?.outputs ?? {})) {
        if (!out.endsWith('.js')) continue;
        const packages: Record<string, number> = {};
        for (const [input, { bytesInOutput }] of Object.entries(inputs)) {
          const pkg = packageOf(input);
          packages[pkg] = (packages[pkg] ?? 0) + bytesInOutput;
        }
        const path = out.replace(/\.js$/, PREBUNDLED_SUFFIX);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ packages }, null, 2)}\n`);
      }
    });
  },
};

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
    external: ['vite', 'vite-plugin-singlefile', 'playwright'],
  },
  // The `comparanda` command.
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    clean: false,
    external: ['vite', 'vite-plugin-singlefile', 'playwright'],
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
    esbuildPlugins: [packageManifest],
  },
]);
