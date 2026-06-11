import * as dotenv from 'dotenv';

dotenv.config();

function required(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Env ${key} wajib di-set. Cek .env atau .env.example.`);
  }
  return value;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type BufferMode = 'now' | 'queue';
export type PostStyle = 'single' | 'best_buy' | 'mixed';

export interface AppConfig {
  buffer: {
    accessToken: string;
    profileId: string;
    mode: BufferMode;
  };
  ai: {
    apiKey: string;
    model: string;
  };
  postStyle: PostStyle;
  bestBuyCount: number;
  timezone: string;
  maxPostsPerDay: number;
  dryRun: boolean;
}

export function loadConfig(): AppConfig {
  const dryRun = bool(process.env.DRY_RUN, false);

  const accessToken = dryRun
    ? process.env.BUFFER_ACCESS_TOKEN ?? 'dryrun'
    : required('BUFFER_ACCESS_TOKEN', process.env.BUFFER_ACCESS_TOKEN);
  const profileId = dryRun
    ? process.env.BUFFER_PROFILE_ID ?? 'dryrun'
    : required('BUFFER_PROFILE_ID', process.env.BUFFER_PROFILE_ID);

  const aiApiKey = required('POLLINATIONS_API_KEY', process.env.POLLINATIONS_API_KEY);
  const aiModel = process.env.POLLINATIONS_MODEL ?? 'openai';

  const rawMode = (process.env.BUFFER_MODE ?? 'now').toLowerCase();
  const mode: BufferMode = rawMode === 'queue' ? 'queue' : 'now';

  const rawStyle = (process.env.POST_STYLE ?? 'mixed').toLowerCase();
  const postStyle: PostStyle =
    rawStyle === 'single'
      ? 'single'
      : rawStyle === 'best_buy' || rawStyle === 'bestbuy'
        ? 'best_buy'
        : 'mixed';

  return {
    buffer: { accessToken, profileId, mode },
    ai: { apiKey: aiApiKey, model: aiModel },
    postStyle,
    bestBuyCount: int(process.env.BEST_BUY_COUNT, 4),
    timezone: process.env.TZ ?? 'Asia/Jakarta',
    maxPostsPerDay: int(process.env.MAX_POSTS_PER_DAY, 4),
    dryRun,
  };
}
