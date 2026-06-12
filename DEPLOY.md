# Deployment: Vercel + cron-job.org

Scheduler dipindah dari GitHub Actions ke kombo **Vercel function +
cron-job.org**. Cron-job.org timing-nya akurat ke menit (free tier), Vercel
function eksekusi `runOnce()` lalu commit state balik ke GitHub.

## Arsitektur

```
cron-job.org (07/12/18/21 WIB)
       │  POST /api/post
       │  Authorization: Bearer <CRON_SECRET>
       ▼
Vercel function /api/post.ts
       │  1. pull data/state.json + post-history.json dari GitHub API
       │  2. runOnce() → AI → Buffer GraphQL → X
       │  3. push state baru balik ke GitHub
       ▼
GitHub repo (state of truth)
```

## 1. Generate GitHub PAT

1. https://github.com/settings/personal-access-tokens/new
2. **Repository access**: pilih repo `qolbudr/x-affiliate`
3. **Permissions** → Repository → **Contents**: `Read and write`
4. Generate, copy token (`github_pat_...`)

## 2. Deploy ke Vercel

```bash
npm i -g vercel
vercel link        # pilih existing project atau bikin baru
vercel deploy --prod
```

Atau import dari GitHub via dashboard https://vercel.com/new.

### Set env vars di Vercel (Settings → Environment Variables)

| Key | Value |
|---|---|
| `BUFFER_ACCESS_TOKEN` | (sama kaya GH Actions secret) |
| `BUFFER_PROFILE_ID` | (sama) |
| `POLLINATIONS_API_KEY` | (sama) |
| `GITHUB_TOKEN` | PAT dari step 1 |
| `GITHUB_REPO` | `qolbudr/x-affiliate` |
| `GITHUB_BRANCH` | `main` (optional, default 'main') |
| `CRON_SECRET` | random string, mis. `openssl rand -hex 32` |
| `POST_STYLE` | `mixed` (atau `single` / `best_buy`) |
| `MAX_POSTS_PER_DAY` | `4` |
| `BEST_BUY_COUNT` | `4` |

Habis deploy, catet URL endpoint-nya: `https://<project>.vercel.app/api/post`.

### Smoke test

```bash
curl -X POST https://<project>.vercel.app/api/post \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Response sukses: `{"ok":true,"durationMs":...}`. Kalau 401, secret salah.
Kalau 500, cek Vercel function logs.

## 3. Setup cron-job.org

1. Sign up di https://cron-job.org/en/
2. **Cronjobs → Create cronjob**
3. **Common settings**:
   - Title: `x-affiliate post`
   - URL: `https://<project>.vercel.app/api/post`
4. **Schedule**:
   - Timezone: `Asia/Jakarta`
   - Execution times: pilih **specific times**
   - Hours: `7, 12, 18, 21`
   - Minutes: `0`
   - Days: `every day`
5. **Advanced**:
   - Request method: `POST`
   - Custom headers:
     - `Authorization: Bearer <CRON_SECRET>` (sama kaya yang di Vercel)
   - Notification on failure: ON (email)
   - Treat as failure: HTTP status `400-599`
6. Save.

Cron-job.org bakal nunjukin "next execution" sesuai timezone WIB. Kamu bisa
trigger manual via tombol "Execute now" buat smoke test.

## 4. (Optional) Disable GH Actions cron

Workflow `.github/workflows/post.yml` udah dimodif: cuma ada
`workflow_dispatch` (manual). Jadi GH Actions gak akan auto-fire lagi —
murni backup buat debugging.

## Troubleshooting

- **401 Unauthorized** → `CRON_SECRET` di Vercel ≠ di header cron-job.org.
- **GH PUT 422** → SHA conflict (race antar invocation). Aman, di-handle
  next run. Kalau persistent, cek apakah ada commit manual barengan.
- **GH PUT 403** → PAT permission salah, harus `Contents: Read and write`.
- **`postsToday` reset random** → Vercel function pull state dari GH dulu
  tiap invocation, jadi seharusnya gak. Kalau masih kejadian, kemungkinan
  push gagal — cek logs.
- **Tweet duplikat** → cron-job.org gak punya retry default (kecuali
  enabled). Kalau Vercel timeout 60s tapi tweet kelanjut ke Buffer,
  mungkin terlanjur post sebelum state push. Bisa toleransi untuk sekarang
  — kalau perlu, tambah idempotency key.
