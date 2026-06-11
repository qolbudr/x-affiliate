import * as fs from 'fs';
import * as path from 'path';
import { Product, RotatorState } from './types';
import { products } from './products';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

/** Berapa produk terakhir yang TIDAK boleh dipilih lagi (anti repeat). */
const RECENT_WINDOW = 3;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function todayWIB(): string {
  // Format YYYY-MM-DD pakai timezone Asia/Jakarta
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function defaultState(): RotatorState {
  return {
    lastPostedNames: [],
    postsToday: 0,
    postsDate: todayWIB(),
    postedSlots: [],
  };
}

function readState(): RotatorState {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return defaultState();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RotatorState>;
    return {
      lastPostedNames: Array.isArray(parsed.lastPostedNames) ? parsed.lastPostedNames : [],
      postsToday: typeof parsed.postsToday === 'number' ? parsed.postsToday : 0,
      postsDate: typeof parsed.postsDate === 'string' ? parsed.postsDate : todayWIB(),
      postedSlots: Array.isArray(parsed.postedSlots) ? parsed.postedSlots : [],
    };
  } catch {
    return defaultState();
  }
}

function writeState(state: RotatorState): void {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Roll counter ke 0 kalau tanggal WIB sudah berganti.
 */
function rollDateIfNeeded(state: RotatorState): RotatorState {
  const today = todayWIB();
  if (state.postsDate !== today) {
    return { ...state, postsDate: today, postsToday: 0, postedSlots: [] };
  }
  return state;
}

export function getDailyPostCount(): number {
  const state = rollDateIfNeeded(readState());
  writeState(state);
  return state.postsToday;
}

export function canPostToday(maxPerDay: number): boolean {
  return getDailyPostCount() < maxPerDay;
}

/**
 * Jam saat ini di zona Asia/Jakarta (0-23) sebagai string 2-digit, ex: '07'.
 */
export function currentSlotWIB(): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hour12: false,
  });
  // Output bisa '07' atau '7' depending on impl; pad manual.
  const raw = fmt.format(new Date()).trim();
  return raw.padStart(2, '0').slice(0, 2);
}

/**
 * Slot prime-time WIB yang dianggap valid buat post-time.
 * Cron jalan tiap 30 menit, tapi cuma slot ini yang fire posting.
 */
export const PRIME_SLOTS_WIB = ['07', '12', '18', '21'] as const;

/**
 * Cek apakah slot WIB saat ini termasuk prime-time. Toleransi 1 jam ke depan
 * dari jam target — kalau cron delay sampe 30-59 menit, masih dianggap match
 * slot itu (mis. 07:45 WIB → masih dianggap slot '07').
 */
export function matchedPrimeSlot(): string | null {
  const slot = currentSlotWIB();
  return (PRIME_SLOTS_WIB as readonly string[]).includes(slot) ? slot : null;
}

export function hasPostedSlotToday(slot: string): boolean {
  const state = rollDateIfNeeded(readState());
  writeState(state);
  return (state.postedSlots ?? []).includes(slot);
}

export function markSlotPosted(slot: string): void {
  const state = rollDateIfNeeded(readState());
  const existing = state.postedSlots ?? [];
  if (!existing.includes(slot)) {
    writeState({ ...state, postedSlots: [...existing, slot] });
  }
}

/**
 * Pilih produk berikutnya yang BUKAN salah satu dari `RECENT_WINDOW` terakhir.
 * Kalau semua produk masuk recent (jumlah produk <= RECENT_WINDOW), reset window.
 */
export function rotateProduct(): Product {
  if (products.length === 0) {
    throw new Error('Daftar produk kosong. Tambahkan minimal 1 produk di src/products.ts.');
  }

  const state = rollDateIfNeeded(readState());
  const blocked = new Set(state.lastPostedNames);
  let candidates = products.filter((p) => !blocked.has(p.name));
  if (candidates.length === 0) candidates = [...products];

  const picked = candidates[Math.floor(Math.random() * candidates.length)] as Product;

  const nextRecent = [picked.name, ...state.lastPostedNames].slice(0, RECENT_WINDOW);
  writeState({ ...state, lastPostedNames: nextRecent });

  return picked;
}

/**
 * Catat bahwa 1 post berhasil hari ini (untuk batas anti-shadowban).
 */
export function recordPost(): void {
  const state = rollDateIfNeeded(readState());
  writeState({ ...state, postsToday: state.postsToday + 1 });
}

/**
 * Pilih `count` produk untuk format thread "best buy".
 * Mengutamakan produk yang BUKAN di recent window. Sisanya diambil acak.
 */
export function pickBestBuyProducts(count: number): Product[] {
  if (products.length === 0) {
    throw new Error('Daftar produk kosong. Tambahkan minimal 1 produk di src/products.ts.');
  }

  const state = rollDateIfNeeded(readState());
  const blocked = new Set(state.lastPostedNames);
  const fresh = products.filter((p) => !blocked.has(p.name));
  const stale = products.filter((p) => blocked.has(p.name));

  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = tmp;
    }
    return copy;
  };

  const picked = [...shuffle(fresh), ...shuffle(stale)].slice(0, Math.min(count, products.length));

  const nextRecent = [
    ...picked.map((p) => p.name),
    ...state.lastPostedNames,
  ].slice(0, Math.max(RECENT_WINDOW, picked.length));
  writeState({ ...state, lastPostedNames: nextRecent });

  return picked;
}
