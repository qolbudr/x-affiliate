import * as fs from 'fs';
import * as path from 'path';

/**
 * Sync data/ files (state.json + post-history.json) bolak-balik ke GitHub
 * lewat REST API. Dipake di environment ephemeral (Vercel function) yang
 * filesystem-nya gak persistent — tiap invocation pull dulu sebelum runOnce,
 * push lagi setelah selesai.
 *
 * Auth: Personal Access Token (fine-grained, repo-scoped) dengan permission
 * "Contents: Read and write".
 *
 * Env yang dibutuhin:
 *  - GITHUB_REPO   = "owner/repo"          (mis. "qolbudr/x-affiliate")
 *  - GITHUB_TOKEN  = github_pat_...
 *  - GITHUB_BRANCH = "main"                (default 'main')
 */

const FILES = ['data/state.json', 'data/post-history.json'] as const;
type RepoFile = (typeof FILES)[number];

interface GhFileResp {
  content: string;
  sha: string;
  encoding: 'base64';
}

interface GhConfig {
  repo: string;
  token: string;
  branch: string;
  dataDir: string;
}

function loadGhConfig(): GhConfig {
  const repo = process.env.GITHUB_REPO?.trim();
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!repo || !token) {
    throw new Error('GITHUB_REPO dan GITHUB_TOKEN wajib di-set buat sync state.');
  }
  const branch = process.env.GITHUB_BRANCH?.trim() || 'main';
  const dataDir = process.env.DATA_DIR?.trim() || path.resolve(process.cwd(), 'data');
  return { repo, token, branch, dataDir };
}

const API = 'https://api.github.com';

async function ghHeaders(token: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'x-affiliate-bot',
  };
}

/**
 * GET file dari repo. Return null kalau file belum exist (404).
 */
async function ghGetFile(
  cfg: GhConfig,
  repoPath: RepoFile,
): Promise<{ content: string; sha: string } | null> {
  const url = `${API}/repos/${cfg.repo}/contents/${repoPath}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: await ghHeaders(cfg.token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GH GET ${repoPath} HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GhFileResp;
  const content = Buffer.from(json.content, 'base64').toString('utf-8');
  return { content, sha: json.sha };
}

/**
 * PUT file ke repo dengan auto-retry on 409 (SHA conflict).
 *
 * GitHub balikin 409 kalau SHA yang kita kasih udah outdated — biasanya karena
 * commit lain (manual push, GH Actions, atau invocation paralel function ini)
 * udah ngubah file di-tengah. Solusi: re-fetch SHA terbaru → retry PUT.
 *
 * `prevSha` adalah SHA yang kita kira state file-nya, tapi kalau remote-nya
 * udah berubah, GitHub bakal nolak. Retry max 3x cukup buat kasus normal.
 */
async function ghPutFile(
  cfg: GhConfig,
  repoPath: RepoFile,
  content: string,
  prevSha: string | null,
  message: string,
): Promise<void> {
  let sha = prevSha;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = `${API}/repos/${cfg.repo}/contents/${repoPath}`;
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        ...(await ghHeaders(cfg.token)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return;

    // 409 = SHA conflict. 422 kadang dipake juga buat conflict di branch
    // ber-protect-rule atau "is at X but expected Y".
    const isConflict = res.status === 409 || res.status === 422;
    if (!isConflict || attempt === maxAttempts) {
      throw new Error(
        `GH PUT ${repoPath} HTTP ${res.status}: ${await res.text()}`,
      );
    }

    // Re-fetch SHA terbaru biar PUT next attempt sukses.
    const fresh = await ghGetFile(cfg, repoPath);
    sha = fresh?.sha ?? null;
    // Tiny backoff biar gak hammer API kalau race-nya cepet.
    await new Promise((r) => setTimeout(r, 250 * attempt));
  }
}

/**
 * Pull state.json + post-history.json dari GitHub ke local DATA_DIR.
 * Kalau remote 404, bikin file kosong/default biar rotator gak error.
 */
export async function pullStateFromGitHub(): Promise<{
  stateSha: string | null;
  historySha: string | null;
}> {
  const cfg = loadGhConfig();
  if (!fs.existsSync(cfg.dataDir)) {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
  }

  const [stateRemote, historyRemote] = await Promise.all([
    ghGetFile(cfg, 'data/state.json'),
    ghGetFile(cfg, 'data/post-history.json'),
  ]);

  const stateLocal = path.join(cfg.dataDir, 'state.json');
  const historyLocal = path.join(cfg.dataDir, 'post-history.json');

  fs.writeFileSync(
    stateLocal,
    stateRemote?.content ??
      JSON.stringify(
        { lastPostedNames: [], postsToday: 0, postsDate: '1970-01-01' },
        null,
        2,
      ),
    'utf-8',
  );
  fs.writeFileSync(historyLocal, historyRemote?.content ?? '[]', 'utf-8');

  return {
    stateSha: stateRemote?.sha ?? null,
    historySha: historyRemote?.sha ?? null,
  };
}

/**
 * Push local DATA_DIR/state.json + post-history.json balik ke GitHub.
 *
 * Sequential (bukan paralel) karena tiap PUT bikin commit baru yang shift HEAD;
 * PUT paralel pasti bikin yang kedua dapet SHA outdated. Sequential + retry
 * di ghPutFile() udah cukup handle race.
 */
export async function pushStateToGitHub(prev: {
  stateSha: string | null;
  historySha: string | null;
}): Promise<void> {
  const cfg = loadGhConfig();
  const stateLocal = path.join(cfg.dataDir, 'state.json');
  const historyLocal = path.join(cfg.dataDir, 'post-history.json');

  if (fs.existsSync(stateLocal)) {
    const content = fs.readFileSync(stateLocal, 'utf-8');
    await ghPutFile(
      cfg,
      'data/state.json',
      content,
      prev.stateSha,
      'chore(state): update rotator state [skip ci]',
    );
  }
  if (fs.existsSync(historyLocal)) {
    const content = fs.readFileSync(historyLocal, 'utf-8');
    await ghPutFile(
      cfg,
      'data/post-history.json',
      content,
      prev.historySha,
      'chore(state): update post history [skip ci]',
    );
  }
}
