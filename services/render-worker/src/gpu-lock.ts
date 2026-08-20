import { constants } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface GpuJobLock {
  release(): Promise<void>;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireGpuJobLock(path: string, jobId: string): Promise<GpuJobLock> {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, jobId, acquiredAt: new Date().toISOString() }));
      let released = false;
      return {
        async release(): Promise<void> {
          if (released) return;
          released = true;
          await handle.close();
          await unlink(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        },
      };
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'EEXIST') throw error;
      let owner: { pid?: unknown; jobId?: unknown } = {};
      try {
        owner = JSON.parse(await readFile(path, 'utf8')) as typeof owner;
      } catch {
        // An unreadable lock is treated as live; deleting it could admit two GPU jobs.
      }
      if (typeof owner.pid !== 'number' || processIsAlive(owner.pid)) {
        throw new Error(`GPU is locked by job ${String(owner.jobId ?? 'unknown')} (pid ${String(owner.pid ?? 'unknown')})`);
      }
      await unlink(path);
    }
  }
  throw new Error('failed to acquire GPU job lock');
}
