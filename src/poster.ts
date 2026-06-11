import { AIClient } from './ai';
import { BufferClient } from './bufferClient';
import { AppConfig } from './config';
import { appendLog, error as logError, info } from './logger';
import {
  canPostToday,
  hasPostedSlotToday,
  markSlotPosted,
  matchedPrimeSlot,
  pickBestBuyProducts,
  recordPost,
  rotateProduct,
} from './rotator';
import { generateBestBuy, generateTweet } from './templates';
import { Product } from './types';

/**
 * Post 1 update (single) ke Buffer.
 */
export async function postTweet(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
  product: Product,
): Promise<void> {
  const { text, format } = await generateTweet(ai, product);
  info('queueing single to buffer', {
    product: product.name,
    format,
    length: text.length,
    mode: config.buffer.mode,
  });

  let updateId: string | null = null;
  let errMsg: string | undefined;

  try {
    const result = await client.post(text, product.images);
    updateId = result.id;
    recordPost();
    info('buffer update created', { id: updateId, mode: result.mode });
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
    logError('buffer post failed', { error: errMsg });
  } finally {
    appendLog({
      timestamp: new Date().toISOString(),
      tweetId: updateId,
      productName: product.name,
      affiliateLink: product.affiliateLink,
      format,
      text,
      replyTweetId: null,
      dryRun: config.dryRun,
      ...(errMsg ? { error: errMsg } : {}),
    });
  }
}

/**
 * Post format "best buy thread" ala @leemonnadee:
 *  - 1 main tweet hype
 *  - N reply per produk (native Twitter thread via Buffer)
 */
export async function postBestBuy(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
  picks: Product[],
): Promise<void> {
  const { main, replies } = await generateBestBuy(ai, picks);
  info('queueing best_buy thread to buffer', {
    count: picks.length,
    products: picks.map((p) => p.name),
    mainLength: main.length,
    mode: config.buffer.mode,
  });

  let updateId: string | null = null;
  let errMsg: string | undefined;

  try {
    // Main tweet thread = header (gak ngerefer ke produk spesifik) jadi gak pake image.
    // Tiap reply (1/N, 2/N, ...) align 1:1 sama picks[i] -> pakai images produknya.
    const replyImages = picks.map((p) => p.images);
    const result = await client.postThread(main, replies, undefined, replyImages);
    updateId = result.id;
    recordPost();
    info('buffer thread created', { id: updateId, mode: result.mode });
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
    logError('buffer thread failed', { error: errMsg });
  } finally {
    appendLog({
      timestamp: new Date().toISOString(),
      tweetId: updateId,
      productName: `best_buy(${picks.map((p) => p.name).join(', ')})`,
      affiliateLink: picks.map((p) => p.affiliateLink).join('\n'),
      format: 'best_buy',
      text: [main, ...replies].join('\n---\n'),
      replyTweetId: null,
      dryRun: config.dryRun,
      ...(errMsg ? { error: errMsg } : {}),
    });
  }
}

/**
 * Eksekusi 1 slot prime-time:
 * - Cek apakah jam sekarang masuk slot prime-time WIB (07/12/18/21).
 *   Bisa di-bypass dengan env FORCE=true (workflow_dispatch manual).
 * - Cek slot ini udah posted hari ini atau belum (anti double-post).
 * - Cek batas harian.
 * - Pilih style berdasarkan POST_STYLE (single | best_buy | mixed)
 * - Kirim ke Buffer
 * - Mark slot as posted.
 */
export async function runOnce(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
): Promise<void> {
  const force = ['1', 'true', 'yes', 'on'].includes(
    (process.env.FORCE ?? '').toLowerCase(),
  );

  // Slot gating: cron `*/30` fire 48x/hari, tapi cuma slot prime-time yang
  // beneran posting. Skip silently kalau bukan slot.
  let slot: string | null = null;
  if (!force) {
    slot = matchedPrimeSlot();
    if (!slot) {
      info('bukan slot prime-time WIB, skip', {});
      return;
    }
    if (hasPostedSlotToday(slot)) {
      info('slot ini udah posted hari ini, skip', { slot });
      return;
    }
  }

  if (!canPostToday(config.maxPostsPerDay)) {
    info('limit harian sudah tercapai, skip', { max: config.maxPostsPerDay });
    return;
  }

  const style = resolveStyle(config);
  if (style === 'best_buy') {
    const picks = pickBestBuyProducts(config.bestBuyCount);
    await postBestBuy(client, ai, config, picks);
  } else {
    const product = rotateProduct();
    await postTweet(client, ai, config, product);
  }

  // Mark slot only after success (any throw above bubbles up & no mark).
  if (slot) markSlotPosted(slot);
}

/**
 * Resolusi style:
 *  - 'single'   -> selalu single tweet
 *  - 'best_buy' -> selalu thread
 *  - 'mixed'    -> 25% chance thread, 75% single (biar feed-mu gak monoton)
 */
function resolveStyle(config: AppConfig): 'single' | 'best_buy' {
  if (config.postStyle === 'best_buy') return 'best_buy';
  if (config.postStyle === 'single') return 'single';
  return Math.random() < 0.25 ? 'best_buy' : 'single';
}
