import * as fs from 'fs';
import * as path from 'path';
import { Product, RotatorState } from './types';
import { products } from './products';

// DATA_DIR di-resolve LAZY tiap call — supaya env DATA_DIR yang di-set
// belakangan (mis. di Vercel function handler) tetep ke-pickup. Kalau
// di-resolve di top-level, env yang di-set setelah modul ke-import gak
// akan kebaca.
function dataDir(): string {
  return process.env.DATA_DIR && process.env.DATA_DIR.trim() !== ''
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), 'data');
}
function stateFile(): string {
  return path.join(dataDir(), 'state.json');
}

/** Berapa produk terakhir yang TIDAK boleh dipilih lagi (anti repeat). */
const RECENT_WINDOW = 3;

function ensureDataDir(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
  };
}

function readState(): RotatorState {
  ensureDataDir();
  const file = stateFile();
  if (!fs.existsSync(file)) return defaultState();
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RotatorState>;
    return {
      lastPostedNames: Array.isArray(parsed.lastPostedNames) ? parsed.lastPostedNames : [],
      postsToday: typeof parsed.postsToday === 'number' ? parsed.postsToday : 0,
      postsDate: typeof parsed.postsDate === 'string' ? parsed.postsDate : todayWIB(),
    };
  } catch {
    return defaultState();
  }
}

function writeState(state: RotatorState): void {
  ensureDataDir();
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Roll counter ke 0 kalau tanggal WIB sudah berganti.
 */
function rollDateIfNeeded(state: RotatorState): RotatorState {
  const today = todayWIB();
  if (state.postsDate !== today) {
    return { ...state, postsDate: today, postsToday: 0 };
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
