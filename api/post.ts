import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AIClient } from '../src/ai';
import { BufferClient } from '../src/bufferClient';
import { loadConfig } from '../src/config';
import { pullStateFromGitHub, pushStateToGitHub } from '../src/githubState';
import { runOnce } from '../src/poster';

/**
 * Webhook endpoint buat cron-job.org.
 *
 * Setup di cron-job.org:
 *   URL     : https://<vercel-url>/api/post
 *   Method  : POST
 *   Headers : Authorization: Bearer <CRON_SECRET>
 *   Schedule: 07:00, 12:00, 18:00, 21:00 WIB (timezone Asia/Jakarta)
 *
 * Env vars yang wajib di Vercel project settings:
 *   - BUFFER_ACCESS_TOKEN
 *   - BUFFER_PROFILE_ID
 *   - POLLINATIONS_API_KEY
 *   - GITHUB_TOKEN          (PAT fine-grained, repo Contents R/W)
 *   - GITHUB_REPO           (mis. "qolbudr/x-affiliate")
 *   - CRON_SECRET           (random string, header Authorization-nya)
 *
 * Optional:
 *   - GITHUB_BRANCH         (default 'main')
 *   - POST_STYLE            (default 'mixed')
 *   - MAX_POSTS_PER_DAY     (default '4')
 *   - BEST_BUY_COUNT        (default '4')
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Auth: cron-job.org kirim Authorization header dengan secret.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(500).json({ error: 'CRON_SECRET not configured' });
    return;
  }
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Vercel functions: project root read-only. Pakai /tmp buat data/.
  process.env.DATA_DIR = '/tmp/x-affiliate-data';
  // Timezone buat rollDate WIB.
  process.env.TZ = 'Asia/Jakarta';

  const startedAt = Date.now();
  try {
    // 1. Pull state terbaru dari GitHub ke /tmp.
    const prev = await pullStateFromGitHub();

    // 2. Run poster.
    const config = loadConfig();
    const client = new BufferClient(config);
    const ai = new AIClient(config.ai);
    const result = await runOnce(client, ai, config);

    // 3. Push state balik ke GitHub.
    await pushStateToGitHub(prev);

    res.status(200).json({
      ok: true,
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[api/post] error', { msg, stack });
    res.status(500).json({ ok: false, error: msg });
  }
}
