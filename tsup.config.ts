import { defineConfig } from 'tsup';

// Three entry points, one per subpath export (ADR-0005). They are built as
// separate chunks so that a consumer importing only `comparanda` never pulls in
// view code -- a condition ADR-0005 makes a requirement of its own acceptance.
// `scripts/check-boundaries.ts` is what actually verifies it.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'view/index': 'src/view/index.ts',
    'store/index': 'src/store/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: true,
  // Emitted so `scripts/check-boundaries.ts` can read which inputs actually
  // landed in the core bundle. Without it that check silently passes, which is
  // worse than not having it.
  metafile: true,
});
