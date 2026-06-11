import { BufferClient } from '../bufferClient';
import { loadConfig } from '../config';

/**
 * List semua Buffer channels (X, IG, dll) yang tersambung ke akun kamu.
 * Copy ID channel X / Twitter kamu, paste ke BUFFER_PROFILE_ID di .env.
 *
 * Run: npm run buffer:profiles
 */
async function main(): Promise<void> {
  // Channel ID belum dibutuhkan untuk endpoint ini → kasih placeholder
  process.env.BUFFER_PROFILE_ID = process.env.BUFFER_PROFILE_ID ?? 'placeholder';

  const config = loadConfig();
  const client = new BufferClient(config);
  const channels = await client.listChannels();

  if (channels.length === 0) {
    console.log('Belum ada channel di Buffer. Connect X / Twitter dulu di buffer.com.');
    return;
  }

  console.log('--- Buffer channels ---');
  for (const c of channels) {
    console.log(`[${c.service.padEnd(10)}] ${c.name}  ->  id: ${c.id}`);
  }
  console.log('\nCopy ID channel X / twitter kamu ke BUFFER_PROFILE_ID di .env.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[fatal]', msg);
  process.exit(1);
});
