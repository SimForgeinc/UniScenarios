import { spawn, type ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [];
const start = (command: string, args: string[]): ChildProcess => {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  return child;
};

const api = start('tsx', ['server/localScenarioCopilotServer.ts']);
const vite = start('vite', process.argv.slice(2));
let shuttingDown = false;
const shutdown = (code = 0): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
};

for (const child of [api, vite]) child.once('exit', (code, signal) => {
  if (!shuttingDown) shutdown(code ?? (signal ? 1 : 0));
});
process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
