import { AIClient } from '../ai';
import { BufferClient } from '../bufferClient';
import { loadConfig } from '../config';
import { runOnce } from '../poster';

/**
 * Manual trigger: kirim 1 update ke Buffer sekarang juga.
 * Useful buat smoke test setelah edit products / template.
 *
 * Run: npm run post:once
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const client = new BufferClient(config);
  const ai = new AIClient(config.ai);
  await runOnce(client, ai, config);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error('[fatal]', msg);
  process.exit(1);
});
