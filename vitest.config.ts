import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'backend/test/**/*.{test,spec}.ts',
      'witness/test/**/*.{test,spec}.ts',
      'test/**/*.{test,spec}.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      // NFR-10: >=85% overall on the tested server surface. Scope notes:
      // - dist/ and frontend build output are regenerable artefacts.
      // - frontend/** has no unit harness yet; its cover arrives with the
      //   Playwright E2E suite (P8) and the AT-624/AT-625 unit tests.
      // - backend/src/cli/** is exercised through child processes (AT-313,
      //   AT-314, AT-912, restore-drill.sh), which v8 cannot attribute.
      // - backend/src/index.ts is bootstrap, covered by boot behaviour.
      // - scripts/** are exercised by the section-11 runs (judge, drill).
      // The 100%-branch rule for policy/, ledger/ and crypto/ is enforced
      // separately by scripts/coverage-gate.mjs (vitest supports only
      // global thresholds).
      include: ['backend/src/**/*.ts', 'witness/src/**/*.ts'],
      exclude: [
        '**/dist/**',
        'frontend/**',
        'scripts/**',
        'backend/src/cli/**',
        'backend/src/index.ts',
        '**/*.config.*'
      ],
      lines: 85,
      functions: 85,
      branches: 85,
      statements: 85
    }
  }
});
