import { AIClient, stripCodeFences } from './ai';
import { Product } from './types';

const TWEET_LIMIT = 280;

/**
 * System prompt untuk semua copy.
 *
 * Persona: micro-influencer cewek Indo, casual & chill ala @leemonnadee.
 * Tujuan utama: drive KLIK link affiliate + CHECKOUT. Boleh sedikit bait
 * (FOMO halus, harga shock, soft CTA) selama tetap kerasa organic.
 *
 * Format wajib output (3 blok dipisah baris kosong):
 *   1. caption hook + soft CTA (1-3 kalimat singkat, tanpa link, tanpa hashtag)
 *   2. <emoji shopping> <affiliate link>
 *   3. <#hashtag1> <#hashtag2> ...
 */
const SYSTEM_PROMPT = `Kamu adalah copywriter Twitter/X buat akun affiliate Shopee Indonesia.

TUJUAN UTAMA:
- Bikin pembaca KLIK link affiliate dan LANJUT CHECKOUT.
- Bukan sekadar engagement — setiap tweet harus punya alasan jelas kenapa orang harus klik SEKARANG.

PERSONA:
- Cewek Indo umur 20-an, vibe casual ala @leemonnadee.
- Ngomongnya kayak chat ke temen deket: santai, nyeleneh, jujur, pakai bahasa gaul Twitter ID.
- Sering pakai kata: "aku", "kalian", "gais", "sumpah", "literally", "sih", "deh", "banget", "aja", "wkwk".

ATURAN COPY:
- BAHASA: Indonesia casual lowercase. JANGAN formal. JANGAN ALL CAPS.
- TONE: organic-recommendation tapi PERSUASIF. Boleh sedikit bait (FOMO halus, harga shock, hint stok cepet abis) — tapi tetap kerasa kayak temen, bukan marketplace.
- HOOK: kalimat pertama wajib bikin scroll berhenti (relatable struggle / harga shock / curiosity / mini-review).
- HARGA: WAJIB sebut harga + framing nilai ("cuma Rp67rb", "gak sampe Rp50rb", "harga segini dapet kualitas segini").
- SOFT CTA: tutup caption dengan dorongan halus ke link, contoh: "cek di link ya", "buruan cek harganya turun", "tak kasih link nya di bawah", "klik aja link nya jangan nyesel", "checkout dulu mumpung murah", "stok cepet abis sih biasanya". WAJIB ada 1 micro-CTA tiap tweet, tapi JANGAN robotik.
- BAIT BOLEH SECUKUPNYA: "checkout sebelum harganya naik lagi", "ini ada flash sale-nya", "yg masih ragu nyesel sih", "dompet aman kok harganya". JANGAN over: hindari ALL CAPS "BURUAN!!!", "DISKON GILA!!!", "STOK TERBATAS!!!".
- LINK: SELALU tampilkan affiliate link APA ADANYA, jangan diubah, jangan ditambahin embel-embel.
- LIMIT: max 280 karakter total (termasuk link & hashtag).

FORMAT WAJIB OUTPUT (3 blok dipisah 1 baris kosong):

  <caption: hook + alasan worth it + harga + soft CTA klik link, 1-3 kalimat, tanpa link, tanpa hashtag>

  <1 emoji shopping: 🛒 atau 🛍️ atau 🛍 atau 👜> <affiliate link>

  <1-3 hashtag relevan, mulai dengan #shopee>

CONTOH OUTPUT (struktur, bukan copy yang harus disalin):
sumpah cardigan ini tebel banget dan jatuhnya pas di badan, cuma Rp67rb 😭 buruan checkout sebelum harganya naik, link nya aku taro bawah ya

🛒 https://s.shopee.co.id/xxxxx

#shopee #ootd #cardigan

OUTPUT:
- Balas HANYA 3 blok di atas, persis sesuai format. Pisah dengan 1 baris kosong.
- JANGAN tambahin label "Tweet:", quote, markdown, atau penjelasan apapun.
- JANGAN gabungin link & caption di blok yang sama.
- JANGAN naro hashtag di blok caption / link.`;

/** Format-format style buat single tweet — biar variatif tiap post. */
const SINGLE_STYLES = [
  'pain_point: relate sama struggle pembaca, posisikan produk sebagai solusi, tutup dengan dorongan klik link biar masalah kelar',
  'social_proof: cerita circle/temen-temen udah pake & suka, soft CTA "cobain juga, link nya di bawah"',
  'trending: kaitin sama momen sekarang (cuaca, gajian, tanggal tua), tutup pake CTA "checkout dulu mumpung pas momennya"',
  'curiosity_gap: bikin penasaran harga vs kualitas, kasih reveal harga shock, dorong klik buat liat sendiri di Shopee',
  'storytelling: cerita singkat kapan nemuin produk & kenapa nyangkut, tutup pake "tak share link nya, sayang banget kalo kelewat"',
  'fomo_soft: hint kalau harga lagi turun / stok suka cepet abis, dorong checkout sekarang sebelum naik lagi (jangan ALL CAPS)',
  'mini_review: kasih 2-3 poin kelebihan singkat ala review jujur, tutup pake CTA klik link buat detail lengkap',
] as const;

const BEST_BUY_INTROS = [
  'BEST BUY VERSI AKU….',
  'rekap barang online yang ga nyesel aku beli',
  'list barang murah yang malah jadi favorit aku',
  'random thread: barang Shopee yang aku rekomendasiin ke temen-temen',
  'thread barang Shopee yang worth it sumpah',
] as const;

const SHOPPING_EMOJIS = ['🛒', '🛍️', '🛍', '👜'] as const;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/**
 * Generate single tweet via AI.
 */
export async function generateTweet(
  ai: AIClient,
  product: Product,
): Promise<{ text: string; format: 'single' }> {
  const style = pickRandom(SINGLE_STYLES);
  const userPrompt = `Buatin 1 tweet promosi affiliate Shopee dengan detail:

- Nama produk: ${product.name}
- Harga: ${product.price}
- Affiliate link: ${product.affiliateLink}
- Style hook: ${style}

GOAL: pembaca KLIK link & lanjut CHECKOUT di Shopee.
Caption WAJIB punya 3 elemen: (1) hook nyangkut, (2) alasan worth it + harga, (3) soft CTA klik link / checkout (boleh sedikit bait FOMO halus, jangan ALL CAPS).
WAJIB ikut format 3 blok (caption / emoji+link / hashtag) seperti aturan SYSTEM.
Wajib pake link & harga persis seperti di atas. Output 1 tweet final, max 280 karakter.`;

  const raw = await ai.generate(SYSTEM_PROMPT, userPrompt);
  const cleaned = sanitizeTweet(raw, product.affiliateLink);
  return {
    text: clampToTweetLimit(cleaned, product.affiliateLink),
    format: 'single',
  };
}

export interface BestBuyOutput {
  main: string;
  replies: string[];
}

/**
 * Generate "best buy" thread via AI.
 *
 * Strategi: 1 prompt buat main hook (header thread), lalu 1 prompt per produk
 * untuk reply. Lebih reliable & cheap daripada minta JSON struktur ke AI.
 *
 * Tweet pembuka thread tidak perlu format 3 blok (cuma teaser tanpa link).
 * Tiap reply WAJIB pakai format 3 blok karena ngandung link affiliate.
 */
export async function generateBestBuy(
  ai: AIClient,
  products: Product[],
): Promise<BestBuyOutput> {
  if (products.length === 0) {
    throw new Error('generateBestBuy butuh minimal 1 produk');
  }

  const intro = pickRandom(BEST_BUY_INTROS);
  const mainUserPrompt = `Buatin tweet pembuka thread "best buy" gaya @leemonnadee.

Konteks:
- Pembuka thread berisi rekomendasi ${products.length} produk Shopee yang worth it.
- Hook utama: "${intro}".
- Tujuan: bikin orang penasaran sampe scroll thread & klik link tiap item.
- Selipin teaser bait halus biar pengen lanjut, contoh "sumpah harganya bikin auto checkout" / "yg ke-3 paling banyak aku rekomendasiin" / "siapin keranjang dulu deh".
- Tutup dengan teks "a thread 🧵 (${products.length})" di baris terakhir.
- JANGAN sebut nama produk satu-satu di tweet pembuka ini.
- JANGAN tampilkan link apapun di tweet pembuka.
- TWEET PEMBUKA INI TIDAK PERLU IKUT FORMAT 3 BLOK (link/emoji/hashtag) — cukup caption + tagline + closer.

Output 1 tweet final saja, max 280 karakter, casual ala @leemonnadee.`;

  const mainRaw = await ai.generate(SYSTEM_PROMPT, mainUserPrompt);
  const main = clampToTweetLimit(sanitizeTweet(mainRaw, ''), '');

  const replies: string[] = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i] as Product;
    const num = i + 1;
    const total = products.length;
    const replyUserPrompt = `Buatin 1 reply tweet untuk thread "best buy".

- Nomor item: ${num}/${total}
- Nama produk: ${p.name}
- Harga: ${p.price}
- Affiliate link: ${p.affiliateLink}

GOAL: pembaca KLIK link reply ini & CHECKOUT produknya.
WAJIB ikut format 3 blok (caption / emoji+link / hashtag) seperti aturan SYSTEM.
Khusus reply ini, blok caption HARUS dimulai dengan "${num}/${total} " lalu diikuti: hook produk + alasan kenapa worth it + harga + soft CTA klik link / checkout (boleh selipin bait halus kayak "buruan cek" / "sebelum harganya naik" / "stok suka cepet abis", jangan ALL CAPS).
Wajib pake link persis seperti di atas. Output 1 reply final, max 280 karakter.`;

    const replyRaw = await ai.generate(SYSTEM_PROMPT, replyUserPrompt);
    const reply = clampToTweetLimit(
      sanitizeTweet(replyRaw, p.affiliateLink),
      p.affiliateLink,
    );
    replies.push(reply);
  }

  return { main, replies };
}

/**
 * Bersihin output AI: hapus quote, code fence, label, whitespace berlebih,
 * lalu strip lone surrogate / replacement char yang kadang balik dari API.
 * Kalau ada requiredLink, paksa ke format 3 blok.
 */
function sanitizeTweet(raw: string, requiredLink: string): string {
  let t = stripBrokenChars(raw);
  t = stripCodeFences(t);
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  t = t.replace(/^(tweet|reply|output|hasil)\s*:\s*/i, '').trim();
  t = t.replace(/\n{3,}/g, '\n\n');

  if (!requiredLink) {
    return t;
  }
  return enforceThreeBlockFormat(t, requiredLink);
}

/**
 * Hapus karakter rusak yang bikin tampilan X/Twitter jadi "?" atau kotak:
 *  - Lone high surrogate (U+D800-DBFF tanpa pasangan)
 *  - Lone low surrogate (U+DC00-DFFF tanpa pasangan)
 *  - Replacement char U+FFFD
 *  - Zero-width joiner / non-joiner / BOM yang bisa nyangkut antar emoji
 *  - Control char (kecuali \n & \t)
 *
 * Pollinations kadang balikin emoji terpotong di tengah surrogate pair —
 * kalau dibiarin, X bakal nampilin jadi ��/?.
 */
function stripBrokenChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    // High surrogate: harus diikuti low surrogate yang valid.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
        continue;
      }
      // Lone high surrogate -> drop.
      continue;
    }
    // Lone low surrogate -> drop.
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    // Replacement char -> drop.
    if (code === 0xfffd) continue;
    // BOM / ZWSP / ZWJ / ZWNJ -> drop (kalau emoji-nya udah valid pair, gak butuh ZWJ tambahan dari noise).
    if (code === 0xfeff || code === 0x200b) continue;
    // Control char (kecuali \n=0x0A dan \t=0x09).
    if (code < 0x20 && code !== 0x0a && code !== 0x09) continue;

    out += text[i];
  }
  return out;
}

/**
 * Pastiin output rapi jadi 3 blok:
 *   1. caption (tanpa link, tanpa hashtag)
 *   2. <emoji> <affiliate link>
 *   3. <#hashtag1> <#hashtag2> ...
 */
function enforceThreeBlockFormat(text: string, requiredLink: string): string {
  // Ekstrak hashtag (urut munculnya), pastiin #shopee ada paling depan.
  const hashtags = (text.match(HASHTAG_RE) ?? []).map((h) => h.toLowerCase());
  const hasShopee = hashtags.some((h) => h === '#shopee');
  if (!hasShopee) hashtags.unshift('#shopee');
  const uniqueTags = Array.from(new Set(hashtags)).slice(0, 3);

  // Buang hashtag dari body — kita rebuild di blok 3.
  let body = text.replace(HASHTAG_RE, '').trim();

  // Tentuin emoji shopping yang bakal dipake (reuse kalo AI udah pake satu).
  const usedEmoji = SHOPPING_EMOJIS.find((e) => body.includes(e));
  const emoji = usedEmoji ?? pickRandom(SHOPPING_EMOJIS);

  // Pisah caption vs link line. Kalau link belum ada di body, captionnya = body.
  const linkPresent = body.includes(requiredLink);
  let captionLines: string[];
  if (linkPresent) {
    const lines = body.split('\n');
    captionLines = lines.filter((line) => !line.includes(requiredLink));
  } else {
    captionLines = body.split('\n');
  }

  // Buang shopping emoji dari caption supaya gak duplikat di blok link.
  // PENTING: pake flag /u — tanpa /u, regex bakal motong di tengah surrogate
  // pair dan ninggalin lone surrogate dari emoji lain (mis. 😭 yang share
  // high surrogate \uD83D dengan 🛒/🛍/👜 → bikin render rusak di X).
  let caption = captionLines
    .join('\n')
    .replace(/[🛒🛍️🛍👜]/gu, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!caption) caption = 'wajib check ini deh, worth it parah';

  const linkBlock = `${emoji} ${requiredLink}`;
  const tagBlock = uniqueTags.join(' ');

  return [caption, linkBlock, tagBlock].join('\n\n');
}

/**
 * Pastikan tweet <= 280 char tanpa motong affiliate link.
 * Kalau kepanjangan, potong bagian sebelum link.
 *
 * Surrogate-safe: gak akan pernah motong di tengah surrogate pair (yang
 * bakal bikin lone surrogate -> render ?/kotak di X).
 */
export function clampToTweetLimit(text: string, preserveUrl: string): string {
  if (text.length <= TWEET_LIMIT) return text;

  if (!preserveUrl) {
    return safeSlice(text, TWEET_LIMIT - 1) + '…';
  }

  const idx = text.indexOf(preserveUrl);
  if (idx === -1) {
    return safeSlice(text, TWEET_LIMIT - 1) + '…';
  }

  const tail = text.slice(idx);
  const head = text.slice(0, idx);
  const allowedHead = TWEET_LIMIT - tail.length - 1;
  if (allowedHead <= 0) {
    return tail;
  }
  return safeSlice(head, allowedHead).trimEnd() + '…\n' + tail;
}

/**
 * Slice yang gak motong di tengah surrogate pair.
 * Kalau index akhir landing di high surrogate, mundur 1 char.
 */
function safeSlice(text: string, end: number): string {
  if (end <= 0) return '';
  if (end >= text.length) return text;
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    // High surrogate di posisi terakhir -> mundur biar pair-nya gak putus.
    return text.slice(0, end - 1);
  }
  return text.slice(0, end);
}
