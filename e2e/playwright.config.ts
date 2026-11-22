import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import type { CoverageReportOptions } from 'monocart-reporter'
import { BASE_URL, REPORT_DIR, ROOT } from './lib/env'

const slashes = (p: string) => p.split(String.fromCharCode(92)).join('/')

const coverage: CoverageReportOptions = {
  name: 'Chronicle web coverage',
  outputDir: path.join(REPORT_DIR, 'coverage'),
  reports: ['v8', 'lcovonly', 'console-summary'],
  // Only the app's own bundle, not Leaflet or the fonts
  entryFilter: (entry) => entry.url.includes('/assets/') && entry.url.endsWith('.js'),
  sourceFilter: (sourcePath) => slashes(sourcePath).includes('web/src/'),
  sourcePath: (filePath) => slashes(filePath).replace(/^.*?(web\/src\/)/, '$1'),
  // Static data that no behaviour test should be asked to cover
  filter: { '**/web/src/fonts.ts': false, '**/web/src/themes.ts': false, '**/web/src/types.ts': false },
  onEnd: async (results) => {
    const files = (results?.files ?? []).map((f: any) => ({ path: f.sourcePath ?? f.path, summary: f.summary }))
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.writeFileSync(path.join(REPORT_DIR, 'coverage-data.json'), JSON.stringify({ summary: results?.summary, files }, null, 2))
  },
}

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(REPORT_DIR, 'artifacts'),
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [
    ['list'],
    ['monocart-reporter', { name: 'Chronicle end-to-end tests', outputFile: path.join(REPORT_DIR, 'tests', 'index.html'), coverage }],
    ['./reporters/features.ts'],
  ],
  use: {
    baseURL: BASE_URL,
    storageState: path.join(ROOT, 'e2e', '.run', 'auth', 'owner.json'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 }, launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
})
