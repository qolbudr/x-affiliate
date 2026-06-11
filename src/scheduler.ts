import * as cron from 'node-cron';
import { AIClient } from './ai';
import { BufferClient } from './bufferClient';
import { AppConfig } from './config';
import { info } from './logger';
import { runOnce } from './poster';

/**
 * Prime-time slots WIB:
 * - 07:00  pagi (commute / scrolling sebelum kerja)
 * - 12:00  jam makan siang
 * - 18:00  pulang kerja
 * - 21:00  prime time malam
 *
 * Cron format: "menit jam * * *"
 */
const PRIME_TIME_CRON = ['0 7 * * *', '0 12 * * *', '0 18 * * *', '0 21 * * *'];

export function scheduleDaily(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
): void {
  for (const expr of PRIME_TIME_CRON) {
    const task = cron.schedule(
      expr,
      async () => {
        info('cron tick', { expr });
        try {
          await runOnce(client, ai, config);
        } catch (e) {
          // Sudah di-log di poster, di sini cukup catch supaya cron loop tetap hidup.
          const msg = e instanceof Error ? e.message : String(e);
          info('cron run finished with error', { error: msg });
        }
      },
      { timezone: config.timezone },
    );
    task.start();
    info('scheduled', { expr, timezone: config.timezone });
  }
}
