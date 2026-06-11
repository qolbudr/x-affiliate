import { AIClient } from './ai';
import { BufferClient } from './bufferClient';
import { loadConfig } from './config';
import { info } from './logger';
import { scheduleDaily } from './scheduler';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new BufferClient(config);
  const ai = new AIClient(config.ai);

  info('x-affiliate starting', {
    timezone: config.timezone,
    maxPostsPerDay: config.maxPostsPerDay,
    dryRun: config.dryRun,
    bufferMode: config.buffer.mode,
    aiModel: config.ai.model,
  });

  scheduleDaily(client, ai, config);

  // Keep process alive.
  process.on('SIGINT', () => {
    info('SIGINT received, shutting down');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    info('SIGTERM received, shutting down');
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error('[fatal]', msg);
  process.exit(1);
});
