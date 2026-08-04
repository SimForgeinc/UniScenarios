import { createServer } from 'node:http';
import { createScenarioCopilotHandler } from './copilot/handler.js';
import { generateDirectDraft } from './copilot/directProvider.js';
import { generateUpstreamChat2Scenic } from './copilot/upstreamProvider.js';
import { generateSimulationAgent } from './copilot/simulationAgentProvider.js';
import { generateSimulationAgentVision } from './copilot/simulationAgentVisionProvider.js';

const port = Number(process.env['UNISCENARIOS_COPILOT_PORT'] ?? 5202);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('UNISCENARIOS_COPILOT_PORT must be a valid unprivileged port');
const server = createServer(createScenarioCopilotHandler({ directProvider: generateDirectDraft, upstreamProvider: generateUpstreamChat2Scenic, simulationAgentProvider: generateSimulationAgent, simulationAgentVisionProvider: generateSimulationAgentVision }));
server.listen(port, '127.0.0.1', () => console.log(`Scenario Copilot listening on http://127.0.0.1:${port}`));
const shutdown = (): void => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
