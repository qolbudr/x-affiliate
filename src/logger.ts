import * as fs from 'fs';
import * as path from 'path';
import { PostLogEntry } from './types';

// DATA_DIR di-resolve LAZY tiap call — supaya env DATA_DIR yang di-set
// belakangan (mis. di Vercel function handler) tetep ke-pickup.
function dataDir(): string {
  return process.env.DATA_DIR && process.env.DATA_DIR.trim() !== ''
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), 'data');
}
function logFile(): string {
  return path.join(dataDir(), 'post-history.json');
}

function ensureDataDir(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readLog(): PostLogEntry[] {
  ensureDataDir();
  const file = logFile();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PostLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLog(entry: PostLogEntry): void {
  ensureDataDir();
  const all = readLog();
  all.push(entry);
  fs.writeFileSync(logFile(), JSON.stringify(all, null, 2), 'utf-8');
}

export function info(msg: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (meta) {
    console.log(`[${ts}] [info] ${msg}`, meta);
  } else {
    console.log(`[${ts}] [info] ${msg}`);
  }
}

export function warn(msg: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (meta) {
    console.warn(`[${ts}] [warn] ${msg}`, meta);
  } else {
    console.warn(`[${ts}] [warn] ${msg}`);
  }
}

export function error(msg: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (meta) {
    console.error(`[${ts}] [error] ${msg}`, meta);
  } else {
    console.error(`[${ts}] [error] ${msg}`);
  }
}
