# x-affiliate

Auto-posting promosi affiliate Shopee ke X (Twitter) lewat **Buffer** — gak kena
biaya $200/bulan API X. Tone casual ala `@leemonnadee`, scheduling prime-time
WIB, rotasi produk anti-spam.

> Kenapa Buffer? X API saat ini minimal **$200/bulan (Basic tier)** untuk endpoint
> create tweet. Buffer free plan: **3 channels × 10 queued posts**, dan punya jalur
> internal sendiri jadi gak kena 402 CreditsDepleted.

## Fitur

- 4 format tweet (pain point, social proof, trending, curiosity gap), rotasi otomatis.
- Cron post di prime-time WIB (07:00 / 12:00 / 18:00 / 21:00).
- 2 mode posting Buffer:
  - `now` — Buffer publish ke X langsung saat cron tick (default).
  - `queue` — masuk Buffer queue, Buffer yang atur jamnya dari posting schedule kamu.
- Rotasi produk anti-repeat (skip 3 produk terakhir).
- Limit harian (default 4 / hari) buat hindari shadowban X.
- Log tiap post ke `data/post-history.json`.
- Mode `DRY_RUN` buat test tanpa hit API.
- Retry sederhana untuk 429 / 5xx + handling 401/403 (auth issue).

## Struktur folder

```
x-affiliate/
├─ src/
│  ├─ index.ts                  entry: load config + start cron
│  ├─ config.ts                 parse .env
│  ├─ products.ts               daftar produk affiliate
│  ├─ types.ts                  Product, TweetFormat, dll
│  ├─ templates.ts              4 generator format + clamp 280 char
│  ├─ rotator.ts                rotasi anti-repeat + counter harian (WIB)
│  ├─ poster.ts                 runOnce + postTweet (kirim ke Buffer)
│  ├─ scheduler.ts              cron 07/12/18/21 WIB
│  ├─ bufferClient.ts           wrapper Buffer API + retry
│  ├─ logger.ts                 info/warn/error + appendLog JSON
│  └─ scripts/
│     ├─ postOnce.ts            trigger manual: kirim 1 update sekarang
│     └─ bufferProfiles.ts      list channel Buffer untuk ambil PROFILE_ID
├─ data/                        state.json + post-history.json (auto)
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ README.md
```

## Setup

### 1. Connect X di Buffer

1. Daftar / login di [buffer.com](https://buffer.com) (free plan cukup).
2. **Connect channel** → pilih X / Twitter → authorize akun yang mau dipakai posting.

### 2. Generate Buffer Access Token

1. Buka [publish.buffer.com/developers/apps](https://publish.buffer.com/developers/apps).
2. Klik **Create new app**. Isi:
   - Name: `x-affiliate` (bebas)
   - Description: `auto-posting affiliate`
   - Website: `https://example.com` (bebas)
   - Callback URL: `http://localhost:3000/callback` (bebas, gak akan dipakai)
3. Submit. Di halaman app, klik **Create Access Token** — generate single-user
   token untuk akun kamu sendiri (gak perlu OAuth flow).
4. Copy token tersebut.

### 3. Install & configure

```bash
npm install
cp .env.example .env
```

Edit `.env`, paste token-nya:

```dotenv
BUFFER_ACCESS_TOKEN=1/abcdef1234567890...
BUFFER_PROFILE_ID=  # diisi setelah step 4
```

### 4. Ambil Profile ID

```bash
npm run buffer:profiles
```

Output mirip:

```
[twitter ] @ranggajusiblas  ->  id: 65xxxxxxxxxxxxxxxxxxxxxx
[instagram] @other          ->  id: ...
```

Copy ID baris `twitter` ke `BUFFER_PROFILE_ID` di `.env`.

### 5. Test

Dry-run (gak hit Buffer beneran):

```bash
DRY_RUN=true npm run post:once
```

Cek `data/post-history.json` — harusnya muncul 1 entri dengan `dryRun: true`.

Test asli (akan publish ke X via Buffer):

```bash
npm run post:once
```

Buka X, harusnya tweet baru muncul. Kalau pakai `BUFFER_MODE=queue`, tweet masuk
Buffer queue dulu dan akan publish sesuai posting schedule Buffer kamu.

### 6. Production

Build sekali, lalu jalanin pakai pm2 supaya cron-nya idup terus:

```bash
npm run build
pm2 start dist/index.js --name x-affiliate
pm2 save
```

## Cara tambah produk baru

Edit `src/products.ts`:

```ts
{
  name: 'serum vitamin C',
  affiliateLink: 'https://s.shopee.co.id/abcd1234',
  price: 'Rp55rb',
  category: 'skincare',
  hook: 'pemakaian 2 minggu udah keliatan glow up-nya',
}
```

Tips bikin `hook` yang nempel:
- Spesifik, bukan generik (hindari "kualitas bagus").
- Tone seperti rekomendasi ke teman, bukan iklan.
- Sebut hasil / experience nyata kalau bisa.

## Konfigurasi

| Env | Default | Keterangan |
|---|---|---|
| `BUFFER_ACCESS_TOKEN` | required | Token dari publish.buffer.com/developers/apps |
| `BUFFER_PROFILE_ID` | required | ID channel X di Buffer (cari pakai `npm run buffer:profiles`) |
| `BUFFER_MODE` | `now` | `now` = publish langsung, `queue` = masuk antrian Buffer |
| `TZ` | `Asia/Jakarta` | Timezone untuk cron |
| `MAX_POSTS_PER_DAY` | `4` | Batas atas anti-shadowban |
| `DRY_RUN` | `false` | `true` = simulasi tanpa hit Buffer |

Mau ubah jam prime-time? Edit `PRIME_TIME_CRON` di `src/scheduler.ts`.

## Catatan growth

- Jangan post link affiliate doang. Selipkan tweet organik (review, daily life)
  di antara post auto biar rasio promotional gak terlalu tinggi.
- Variasi hashtag per kategori bantu nyangkut di niche audience.
- Pantau `data/post-history.json` — kalau impressi drop drastis, kemungkinan
  shadowban. Pause 24-48 jam, kurangi `MAX_POSTS_PER_DAY` ke 2.
- Affiliate link Shopee sebaiknya pakai shortlink resmi (`s.shopee.co.id`)
  supaya tracking-nya akurat.

## Limitasi Buffer free plan

- Max **10 queued posts** per channel.
  - Karena script default pakai `now` mode (bukan queue), limit ini gak ngegangu
    — Buffer langsung kirim ke X tanpa numpuk di queue.
- Max **3 channel** total. Aman buat 1 akun X.
- Buffer free belum ada native thread / reply otomatis. Kalau butuh, perlu
  Buffer paid plan atau pivot ke X API Basic tier.

## Disclaimer

Pastikan kepatuhan ke
[X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation),
[Terms of Service Buffer](https://buffer.com/terms), dan kebijakan affiliate
Shopee. Otomatisasi yang agresif bisa berujung suspend / ban — script ini
sengaja conservative (max 4 post/hari, retry graceful) tapi tanggung jawab final
ada di kamu.
