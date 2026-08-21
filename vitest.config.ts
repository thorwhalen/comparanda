import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The core is pure and must stay testable in plain Node with no DOM
    // (ADR-0005). Tests that need a DOM live under tests/view/ and opt in.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
