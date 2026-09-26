import { defineConfig, devices } from '@playwright/test';

// Real-media browser suite: two pages in one Chromium context exchange real
// WebRTC audio/video/screen-share and data-channel messages using fake
// capture devices and BroadcastChannel signaling (no backend required).
const PORT = 8091;

export default defineConfig({
  testDir: './e2e',
  testMatch: /media\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone', 'camera'],
    launchOptions: {
      // Use the pre-installed Chromium when the package expects a newer build
      // (CI containers): PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_E2E_LOCAL_SIGNALING: '1',
      VITE_TRANSLATION_PROVIDER: 'mock',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://e2e.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'e2e-anon-key',
      VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID || 'e2e',
    },
  },
});
