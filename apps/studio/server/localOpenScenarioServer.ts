import { createServer } from 'node:http';
import { createLocalOpenScenarioHandler } from './localOpenScenario.js';

const port = Number(process.env['UNISCENARIOS_LOCAL_RUNNER_PORT'] ?? 5201);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('UNISCENARIOS_LOCAL_RUNNER_PORT must be a valid unprivileged port');
const handler = createLocalOpenScenarioHandler();
const server = createServer(handler);
server.listen(port, '127.0.0.1', () => console.log(`Local OpenSCENARIO runner listening on http://127.0.0.1:${port}`));

const shutdown = (): void => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
