/** One isolated catalog attempt. The parent owns scheduling and checkpoints. */
import { register } from 'tsx/esm/api';

register();
await import('./catalog-batch-worker-impl.ts');
