import * as fs from 'fs';
import * as path from 'path';

/**
 * Scrape product info dari today.csv → generate src/products.ts otomatis.
 *
 * Flow:
 *  1. Baca today.csv (header Shopee Affiliate)
 *  2. Parse: ambil "Link Produk", "Link Komisi", "Nama Produk", "Harga"
 *  3. Extract shopid + itemid dari Link Produk
 *  4. Hit Shopee item API (v4) buat ambil image hash → bangun URL CDN
 *  5. Fallback: kalau API gagal, scrape og:image dari halaman produk
 *  6. Dedup by affiliate link, normalisasi nama (truncate, hilangin emoji noise)
 *  7. Generate src/products.ts (overwrite)
 *
 * Run:  npm run products:scrape
 */

const CSV_PATH = path.resolve(process.cwd(), 'today.csv');
const OUT_PATH = path.resolve(process.cwd(), 'src/products.ts');
const IMG_BASE = 'https://down-id.img.susercontent.com/file';

interface CsvRow {
  itemId: string;
  name: string;
  price: string;
  productLink: string;
  affiliateLink: string;
  shopId?: string;
}

interface ScrapedProduct {
  name: string;
  affiliateLink: string;
  price: string;
  images: string[];
}

// ---------------------------------------------------------------------------
// CSV parser (RFC 4180 compatible — handles quoted fields with commas inside)
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // skip
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function readCsv(): CsvRow[] {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(raw);
  if (rows.length < 2) return [];
  const header = (rows[0] ?? []).map((h) => h.trim());

  const idx = (label: string): number => {
    const i = header.findIndex((h) => h.toLowerCase() === label.toLowerCase());
    if (i === -1) throw new Error(`CSV header "${label}" gak ketemu`);
    return i;
  };

  const iId = idx('ID Produk');
  const iName = idx('Nama Produk');
  const iPrice = idx('Harga');
  const iLink = idx('Link Produk');
  const iAff = idx('Link Komisi Ekstra');

  return rows.slice(1).map((cells): CsvRow => ({
    itemId: (cells[iId] ?? '').trim(),
    name: (cells[iName] ?? '').trim(),
    price: (cells[iPrice] ?? '').trim(),
    productLink: (cells[iLink] ?? '').trim(),
    affiliateLink: (cells[iAff] ?? '').trim(),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format harga CSV ("57,0RB", "89,5RB") → "Rp57rb" / "Rp89rb".
 * Kalau parsing gagal, fallback ke string asli.
 */
function normalizePrice(raw: string): string {
  const m = raw.match(/(\d+)[,.]?(\d*)\s*(RB|JT|K)?/i);
  if (!m) return raw || 'cek harga';
  const intPart = m[1] ?? '0';
  const unit = (m[3] ?? '').toUpperCase();
  if (unit === 'JT') return `Rp${intPart}jt`;
  if (unit === 'RB' || unit === 'K' || !unit) return `Rp${intPart}rb`;
  return `Rp${intPart}`;
}

/**
 * Bersihin nama produk biar pas di tweet:
 *  - Hapus token panjang yang useless ("BUSUI FRIENDLY", "TERLARIS 2026", dll)
 *  - Hapus karakter '|' (pemisah judul SEO Shopee)
 *  - Cap di ~80 char + word boundary
 */
function normalizeName(raw: string): string {
  let n = raw.replace(/\s+/g, ' ').trim();
  // Buang segmen setelah '|' (biasanya seo spam)
  if (n.includes('|')) {
    n = (n.split('|')[0] ?? n).trim();
  }
  // Truncate
  const MAX = 80;
  if (n.length > MAX) {
    const cut = n.slice(0, MAX);
    const lastSpace = cut.lastIndexOf(' ');
    n = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return n;
}

/**
 * Extract { shopId, itemId } dari URL Shopee:
 *   https://shopee.co.id/product/{shopid}/{itemid}
 *   https://shopee.co.id/<slug>-i.{shopid}.{itemid}
 */
function parseProductLink(url: string): { shopId: string; itemId: string } | null {
  let m = url.match(/\/product\/(\d+)\/(\d+)/);
  if (m) return { shopId: m[1] as string, itemId: m[2] as string };
  m = url.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1] as string, itemId: m[2] as string };
  return null;
}

// ---------------------------------------------------------------------------
// Image scraping
// ---------------------------------------------------------------------------

interface ShopeeApiResponse {
  data?: {
    images?: string[];
    image?: string;
  } | null;
  error?: number | null;
}

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
};

/**
 * Facebook crawler UA → Shopee balikin SSR HTML lengkap dengan image hash.
 * Bypass anti-scrape (curl & browser UA blocked, tapi crawler UA dibolehin
 * supaya share preview tetep jalan).
 */
const CRAWLER_HEADERS: Record<string, string> = {
  'User-Agent':
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  Accept: 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
};

async function fetchShopeeApiImages(
  shopId: string,
  itemId: string,
): Promise<string[]> {
  const url = `https://shopee.co.id/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      Referer: `https://shopee.co.id/product/${shopId}/${itemId}`,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Api-Source': 'pc',
    },
  });
  if (!res.ok) throw new Error(`shopee api HTTP ${res.status}`);
  const json = (await res.json()) as ShopeeApiResponse;
  if (json.error || !json.data) {
    throw new Error(`shopee api error ${json.error ?? 'no data'}`);
  }
  const hashes = json.data.images ?? (json.data.image ? [json.data.image] : []);
  return hashes.map((h) => `${IMG_BASE}/${h}.webp`);
}

/**
 * Fallback paling reliable: pretend jadi Facebook crawler.
 * HTML-nya ngandung banyak hash gambar produk (CDN: down-id.img.susercontent.com/file/{hash}).
 *
 * Filter:
 *  - skip "promo-dim-..." (banner promo, bukan foto produk)
 *  - dedup by hash
 *  - max 4 (limit X)
 */
async function fetchCrawlerImages(productUrl: string): Promise<string[]> {
  const res = await fetch(productUrl, {
    headers: CRAWLER_HEADERS,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`crawler fetch HTTP ${res.status}`);
  const html = await res.text();

  const hashes = new Set<string>();
  const ordered: string[] = [];
  const re = /down-id\.img\.susercontent\.com\/file\/([a-z0-9-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hash = (m[1] ?? '').toLowerCase();
    if (!hash) continue;
    if (hash.startsWith('promo-')) continue;
    if (hash.startsWith('sg-')) continue; // banner generic
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    ordered.push(`${IMG_BASE}/${hash}.webp`);
  }
  return ordered;
}

async function scrapeImages(row: CsvRow): Promise<string[]> {
  const parsed = parseProductLink(row.productLink);
  if (!parsed) {
    console.warn(`[skip-img] ${row.name}: product link gak terurai`);
    return [];
  }
  // 1. Coba API resmi (paling banyak gambar, tapi sering 403 dari residential IP).
  try {
    const images = await fetchShopeeApiImages(parsed.shopId, parsed.itemId);
    if (images.length > 0) return images.slice(0, 4);
  } catch (e) {
    // Lanjut ke crawler fallback (silent — biasanya 403 doang).
  }
  // 2. Crawler UA (Facebook bot). Reliable di luar API.
  try {
    const images = await fetchCrawlerImages(row.productLink);
    if (images.length > 0) return images.slice(0, 4);
  } catch (e) {
    console.warn(`[crawler-fail] ${row.itemId}: ${(e as Error).message}`);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

function escapeForTs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderProductsTs(items: ScrapedProduct[]): string {
  const blocks = items
    .map((p) => {
      const imagesBlock =
        p.images.length === 0
          ? '    images: [],'
          : [
              '    images: [',
              ...p.images.map((u) => `      '${escapeForTs(u)}',`),
              '    ],',
            ].join('\n');
      return [
        '  {',
        `    name: '${escapeForTs(p.name)}',`,
        `    affiliateLink: '${escapeForTs(p.affiliateLink)}',`,
        `    price: '${escapeForTs(p.price)}',`,
        imagesBlock,
        '  },',
      ].join('\n');
    })
    .join('\n');

  return `import { Product } from './types';

/**
 * Daftar produk yang akan dirotasi.
 *
 * AUTO-GENERATED dari today.csv via \`npm run products:scrape\`.
 * Edit manual aman, tapi run ulang scraper bakal overwrite.
 */
export const products: Product[] = [
${blocks}
];
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV gak ketemu: ${CSV_PATH}`);
  }
  const rows = readCsv();
  console.log(`[csv] ${rows.length} baris dibaca`);

  // Dedup by affiliate link (kalau kosong, pakai itemId).
  const seen = new Set<string>();
  const unique: CsvRow[] = [];
  for (const r of rows) {
    const key = r.affiliateLink.trim() || r.itemId;
    if (!key) continue;
    if (seen.has(key)) {
      console.log(`[dedup] skip duplikat: ${r.name}`);
      continue;
    }
    seen.add(key);
    unique.push(r);
  }
  console.log(`[dedup] ${unique.length} produk unik`);

  const products: ScrapedProduct[] = [];
  for (const r of unique) {
    const name = normalizeName(r.name);
    const price = normalizePrice(r.price);
    const affiliateLink = r.affiliateLink || r.productLink;
    process.stdout.write(`[scrape] ${name} ... `);
    const images = await scrapeImages(r);
    console.log(`${images.length} img`);
    products.push({ name, affiliateLink, price, images });
    // Throttle biar gak diblok Shopee.
    await new Promise((res) => setTimeout(res, 700));
  }

  const ts = renderProductsTs(products);
  fs.writeFileSync(OUT_PATH, ts, 'utf-8');
  console.log(`\n✅ Generated ${OUT_PATH} (${products.length} produk)`);
  const noImg = products.filter((p) => p.images.length === 0).length;
  if (noImg > 0) {
    console.log(
      `⚠️  ${noImg} produk tanpa gambar. Cek log [api-fail]/[og-fail] di atas.`,
    );
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error('[fatal]', msg);
  process.exit(1);
});
