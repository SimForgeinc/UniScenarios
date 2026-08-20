import {
  createControlTransport,
  loadRenderWorkerConfig,
  runRenderWorker,
  startWorkerHealthServer,
} from '@uniscenarios/render-worker';

import { EXIT } from '../errors.js';

export async function workerStart(configPath: string): Promise<number> {
  const config = await loadRenderWorkerConfig(configPath);
  const health = await startWorkerHealthServer(config.health.host, config.health.port);
  const transport = await createControlTransport(config);
  const drain = new AbortController();
  let signalCount = 0;
  const handleSignal = (signal: NodeJS.Signals): void => {
    signalCount += 1;
    if (signalCount === 1) drain.abort(new Error(`draining after ${signal}`));
    else process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  try {
    await runRenderWorker(config, transport, health, drain.signal);
    return EXIT.ok;
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    await health.close();
  }
}
