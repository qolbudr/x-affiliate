import * as fs from 'fs';
import * as path from 'path';
import { PostLogEntry } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'post-history.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readLog(): PostLogEntry[] {
  ensureDataDir();
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf-8');
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
  fs.writeFileSync(LOG_FILE, JSON.stringify(all, null, 2), 'utf-8');
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
