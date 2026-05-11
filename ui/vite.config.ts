import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { aiApplyApiPlugin } from './plugins/aiApply.ts';
import { appliedApiPlugin } from './plugins/applied.ts';
import { applyQueueApiPlugin } from './plugins/applyQueue.ts';
import { briefApiPlugin } from './plugins/brief.ts';
import { cleanApiPlugin } from './plugins/clean.ts';
import { dataApiPlugin } from './plugins/data.ts';
import { diskUsageApiPlugin } from './plugins/diskUsage.ts';
import { envApiPlugin } from './plugins/env.ts';
import { fetchJobsApiPlugin } from './plugins/fetchJobs.ts';
import { jobBodyApiPlugin } from './plugins/jobBody.ts';
import { llmDetectApiPlugin } from './plugins/llmDetect.ts';
import { llmTestApiPlugin } from './plugins/llmTest.ts';
import { preferencesApiPlugin } from './plugins/preferences.ts';
import { profileApiPlugin } from './plugins/profile.ts';
import { runSummaryApiPlugin } from './plugins/runSummary.ts';
import { schedulerOpsApiPlugin } from './plugins/scheduler.ts';
import { schedulerStatusApiPlugin } from './plugins/schedulerStatus.ts';

// HIGH-5: this file used to inline ~1700 lines of dev-server middleware. Each
// API endpoint now lives under `./plugins/`. Keep this file thin: imports +
// plugin registration. Business logic, validators, and shared helpers go in
// `plugins/_paths.ts` / `plugins/_shared.ts` or the per-plugin file.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    appliedApiPlugin(),
    briefApiPlugin(),
    dataApiPlugin(),
    preferencesApiPlugin(),
    llmDetectApiPlugin(),
    aiApplyApiPlugin(),
    applyQueueApiPlugin(),
    jobBodyApiPlugin(),
    fetchJobsApiPlugin(),
    profileApiPlugin(),
    schedulerStatusApiPlugin(),
    schedulerOpsApiPlugin(),
    llmTestApiPlugin(),
    runSummaryApiPlugin(),
    diskUsageApiPlugin(),
    envApiPlugin(),
    cleanApiPlugin(),
  ],
  server: { port: 5173, open: true, host: '127.0.0.1' },
});
