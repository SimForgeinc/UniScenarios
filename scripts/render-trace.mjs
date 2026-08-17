#!/usr/bin/env node

import { runTraceRenderCli } from '../packages/trace-render/src/index.mjs';

runTraceRenderCli().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message}\n`);
  process.exit(1);
});
