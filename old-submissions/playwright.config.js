import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const baseURL = 'http://127.0.0.1:4197';
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL, launchOptions: existsSync(edgePath) ? { executablePath: edgePath } : {} },
  webServer: {
    command: 'node tests/serve-browser.js', url: baseURL, reuseExistingServer: false,
    env: { PORT: '4197', OPENAI_API_KEY: '' },
  },
});
