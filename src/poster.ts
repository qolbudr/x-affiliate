import { AIClient } from './ai';
import { BufferClient } from './bufferClient';
import { AppConfig } from './config';
import { appendLog, error as logError, info } from './logger';
import { canPostToday, pickBestBuyProducts, recordPost, rotateProduct } from './rotator';
import { generateBestBuy, generateTweet } from './templates';
import { Product } from './types';

interface PostOutcome {
  tweetId: string | null;
  error?: string;
}

/**
 * Post 1 update (single) ke Buffer.
 */
export async function postTweet(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
  product: Product,
): Promise<PostOutcome> {
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
  return { tweetId: updateId, ...(errMsg ? { error: errMsg } : {}) };
}

/**
 * Post format "best buy thread" ala @leemonnadee.
 */
export async function postBestBuy(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
  picks: Product[],
): Promise<PostOutcome> {
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
  return { tweetId: updateId, ...(errMsg ? { error: errMsg } : {}) };
}

/**
 * Hasil 1 invocation runOnce.
 *  - 'posted'        → tweet dibuat (atau di-queue) di Buffer
 *  - 'limit_reached' → batas harian sudah tercapai
 *  - 'no_products'   → daftar produk kosong
 */
export interface RunOnceResult {
  status: 'posted' | 'limit_reached' | 'no_products';
  style?: 'single' | 'best_buy';
  product?: string;
  /** Buffer update id (atau 'dryrun-...' kalau DRY_RUN). null kalau gagal post. */
  tweetId?: string | null;
  /** Error message kalau Buffer call gagal (status tetap 'posted' karena attempt udah dilakukan). */
  postError?: string;
  /** True kalau env DRY_RUN aktif — tweet GAK dikirim ke Buffer. */
  dryRun?: boolean;
  /** Buffer mode: 'now' (post langsung) atau 'queue' (masuk antrian). */
  bufferMode?: string;
  postsToday?: number;
  maxPostsPerDay?: number;
}

/**
 * Eksekusi 1 slot prime-time:
 * - Cek batas harian (anti shadowban)
 * - Pilih style berdasarkan POST_STYLE (single | best_buy | mixed)
 * - Kirim ke Buffer
 */
export async function runOnce(
  client: BufferClient,
  ai: AIClient,
  config: AppConfig,
): Promise<RunOnceResult> {
  if (!canPostToday(config.maxPostsPerDay)) {
    info('limit harian sudah tercapai, skip', { max: config.maxPostsPerDay });
    return {
      status: 'limit_reached',
      maxPostsPerDay: config.maxPostsPerDay,
      dryRun: config.dryRun,
    };
  }

  const style = resolveStyle(config);
  if (style === 'best_buy') {
    const picks = pickBestBuyProducts(config.bestBuyCount);
    const outcome = await postBestBuy(client, ai, config, picks);
    return {
      status: 'posted',
      style: 'best_buy',
      product: picks.map((p) => p.name).join(', '),
      tweetId: outcome.tweetId,
      ...(outcome.error ? { postError: outcome.error } : {}),
      dryRun: config.dryRun,
      bufferMode: config.buffer.mode,
    };
  }
  const product = rotateProduct();
  const outcome = await postTweet(client, ai, config, product);
  return {
    status: 'posted',
    style: 'single',
    product: product.name,
    tweetId: outcome.tweetId,
    ...(outcome.error ? { postError: outcome.error } : {}),
    dryRun: config.dryRun,
    bufferMode: config.buffer.mode,
  };
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
