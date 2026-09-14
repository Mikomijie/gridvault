import { defineConfig, devices } from '@playwright/test';

// E2E runs the real stack: seeded demo API on :8080 plus the Vite dev
// server on :5173. The API reseeds on every run (demo:reset) so specs are
// deterministic and isolated from developer data.
export default defineConfig({
  testDir: './frontend/test/e2e',
  fullyParallel: false,
  // One worker, alphabetical files: the AT-612 tamper runs last and the
  // next run reseeds, so no spec observes another spec's corruption.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'mkdir -p data && npm run demo:reset && npx tsx frontend/test/e2e/seed-extensions.ts && npx tsx backend/src/index.ts',
      port: 8080,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        PORT: '8080',
        GRIDVAULT_MASTER_KEY: 'k8s9J3nF9x0q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6=',
        ACCESS_TOKEN_TTL_MINUTES: '1',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
        DEMO_MODE: 'true',
        LOG_LEVEL: 'error'
      } as Record<string, string>
    },
    {
      command: 'npm run dev --workspace=frontend',
      port: 5173,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: 'http://localhost:8080',
        // Fast, deterministic timing for the offline and lock specs.
        VITE_HEARTBEAT_MS: '1000',
        VITE_OFFLINE_FAILURES: '2',
        VITE_IDLE_LOCK_SECONDS: '6',
        VITE_HARD_LOCK_SECONDS: '25'
      } as Record<string, string>
    }
  ]
});
