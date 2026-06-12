import { AppConfig, BufferMode } from './config';
import { error as logError, info, warn } from './logger';

export interface PostResult {
  /** Buffer post id (atau "dryrun-..." kalau dry-run) */
  id: string;
  /** Teks yang dikirim ke Buffer */
  text: string;
  /** Mode yang dipakai saat ngirim */
  mode: BufferMode | 'dryrun';
}

export interface ChannelInfo {
  id: string;
  name: string;
  service: string;
}

const BUFFER_GRAPHQL = 'https://api.buffer.com';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

interface AccountResponse {
  account: {
    organizations: Array<{ id: string; name: string }>;
  };
}

interface ChannelsResponse {
  channels: Array<{ id: string; name: string; service: string }>;
}

interface CreatePostResponse {
  createPost:
    | { __typename?: 'PostActionSuccess'; post: { id: string; text: string; dueAt?: string } }
    | { __typename?: string; message?: string };
}

/**
 * Wrapper Buffer GraphQL API (api.buffer.com).
 *
 * Authentication: Bearer token dari publish.buffer.com/settings/api
 * Endpoint: POST https://api.buffer.com  body { query, variables }
 */
export class BufferClient {
  private readonly token: string;
  private readonly channelId: string;
  private readonly mode: BufferMode;
  private readonly dryRun: boolean;
  private cachedOrgId: string | null = null;

  constructor(config: AppConfig) {
    this.token = config.buffer.accessToken;
    this.channelId = config.buffer.profileId;
    this.mode = config.buffer.mode;
    this.dryRun = config.dryRun;
  }

  async post(text: string, images?: string[]): Promise<PostResult> {
    const assets = toImageAssets(images);
    if (this.dryRun) {
      const id = `dryrun-${Date.now()}`;
      info('DRY_RUN buffer post', { id, mode: this.mode, text, imageCount: assets.length });
      return { id, text, mode: 'dryrun' };
    }

    return this.withRetry(async () => {
      const variables: Record<string, unknown> = {
        input: this.buildCreatePostInput({ text, assets }),
      };
      return this.runCreatePost(variables);
    }, 'post');
  }

  /**
   * Post format "best buy thread":
   *  - 1 main tweet hype (intro hook)
   *  - N reply per produk (native Twitter thread via Buffer)
   *
   * PENTING: di Buffer GraphQL, kalo `metadata.twitter.thread` di-set, SEMUA
   * tweet diambil dari array itu — top-level `text` jadi cuma fallback/preview.
   * Jadi MAIN tweet WAJIB di-include sebagai item pertama di `thread`,
   * bukan cuma di `text`.
   *
   * Buffer akan publish thread mulai dari `thread[0]` ke X, lalu otomatis post
   * tiap item berikutnya sebagai reply ke item sebelumnya.
   */
  async postThread(
    main: string,
    replies: string[],
    mainImages?: string[],
    replyImages?: Array<string[] | undefined>,
  ): Promise<PostResult> {
    const mainAssets = toImageAssets(mainImages);
    const replyInputs = replies.map((text, i) => ({
      text,
      assets: toImageAssets(replyImages?.[i]),
    }));
    // FULL thread = [main, ...replies]. Buffer pake ini sebagai source of truth.
    const fullThread = [{ text: main, assets: mainAssets }, ...replyInputs];

    if (this.dryRun) {
      const id = `dryrun-${Date.now()}`;
      info('DRY_RUN buffer thread', {
        id,
        mode: this.mode,
        threadCount: fullThread.length,
        tweets: fullThread.map((t) => ({
          text: t.text,
          imageCount: t.assets.length,
        })),
      });
      return { id, text: main, mode: 'dryrun' };
    }

    return this.withRetry(async () => {
      const variables: Record<string, unknown> = {
        input: this.buildCreatePostInput({
          // text/assets di-set juga sebagai fallback kalau Buffer butuh
          // top-level fields (mis. buat preview di dashboard).
          text: main,
          assets: mainAssets,
          metadata: {
            twitter: {
              thread: fullThread,
            },
          },
        }),
      };
      return this.runCreatePost(variables);
    }, 'thread');
  }

  private buildCreatePostInput(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      channelId: this.channelId,
      schedulingType: 'automatic',
      assets: [],
      ...(this.mode === 'now'
        ? {
            mode: 'customScheduled',
            dueAt: new Date(Date.now() + 60_000).toISOString(),
          }
        : { mode: 'addToQueue' }),
      ...extra,
    };
  }

  private async runCreatePost(variables: Record<string, unknown>): Promise<PostResult> {
    const data = await this.gql<CreatePostResponse>(
      `mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post { id text dueAt }
          }
          ... on MutationError {
            message
          }
        }
      }`,
      variables,
    );

    const payload = data.createPost;
    if ('post' in payload && payload.post) {
      return { id: payload.post.id, text: payload.post.text, mode: this.mode };
    }
    const msg = (payload as { message?: string }).message ?? 'createPost returned no post';
    throw new BufferApiError(200, msg, payload);
  }

  async listChannels(): Promise<ChannelInfo[]> {
    const orgId = await this.getOrganizationId();
    const data = await this.gql<ChannelsResponse>(
      `query GetChannels($input: ChannelsInput!) {
        channels(input: $input) {
          id
          name
          service
        }
      }`,
      { input: { organizationId: orgId } },
    );
    return data.channels;
  }

  private async getOrganizationId(): Promise<string> {
    if (this.cachedOrgId) return this.cachedOrgId;
    const data = await this.gql<AccountResponse>(
      `query GetOrgs { account { organizations { id name } } }`,
    );
    const first = data.account.organizations[0];
    if (!first) {
      throw new BufferApiError(200, 'Akun Buffer kamu belum punya organization', data);
    }
    this.cachedOrgId = first.id;
    return first.id;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(BUFFER_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });

    const json = (await res.json().catch(() => ({}))) as GraphQLResponse<T>;

    if (!res.ok) {
      throw new BufferApiError(res.status, `HTTP ${res.status}`, json);
    }
    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map((e) => e.message).join('; ');
      throw new BufferApiError(res.status, msg, json.errors);
    }
    if (!json.data) {
      throw new BufferApiError(res.status, 'GraphQL response has no data', json);
    }
    return json.data;
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof BufferApiError) {
          if (err.status === 429 && attempt < maxAttempts) {
            const waitMs = 30_000 * attempt;
            warn(`[${label}] Buffer rate limited, retry in ${waitMs}ms`, { attempt });
            await sleep(waitMs);
            continue;
          }
          if (err.status === 401 || err.status === 403) {
            logError(`[${label}] Buffer auth error ${err.status} — cek BUFFER_ACCESS_TOKEN`, {
              data: err.data,
            });
            throw err;
          }
          if (err.status >= 500 && attempt < maxAttempts) {
            const waitMs = 2_000 * attempt;
            warn(`[${label}] Buffer server error ${err.status}, retry in ${waitMs}ms`);
            await sleep(waitMs);
            continue;
          }
        }
        throw err;
      }
    }
    throw lastErr;
  }
}

export class BufferApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = 'BufferApiError';
    this.status = status;
    this.data = data;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert URL gambar publik jadi `AssetInput[]` sesuai schema Buffer GraphQL:
 *
 *   AssetInput { image: ImageAssetInput }
 *   ImageAssetInput { url!, thumbnailUrl?, metadata? }
 *   ImageMetadataInput { altText! }
 *
 * Twitter (X) max 4 image per tweet, otomatis di-truncate.
 * URL HARUS publicly accessible via HTTPS — Buffer akan fetch sendiri.
 */
function toImageAssets(urls: string[] | undefined): Array<Record<string, unknown>> {
  if (!urls || urls.length === 0) return [];
  return urls
    .filter((u) => typeof u === 'string' && u.trim().length > 0)
    .slice(0, 4)
    .map((url) => ({
      image: {
        url,
        metadata: {
          // altText required (NON_NULL String). Pakai string kosong fallback —
          // user bisa override pakai alt text per produk nanti kalau perlu.
          altText: '',
        },
      },
    }));
}
