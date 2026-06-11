import { warn } from './logger';

/**
 * Wrapper Pollinations AI Text API.
 *
 * Endpoint:  GET https://gen.pollinations.ai/text/{prompt}?model=...
 * Auth:      Bearer token (POLLINATIONS_API_KEY)
 * Response:  plain text
 *
 * System prompt + user prompt digabung dalam satu prompt karena endpoint
 * GET cuma terima 1 prompt string. Marker [SYSTEM] / [USER] biar model bisa
 * bedain instruksi vs request.
 */

const BASE = 'https://gen.pollinations.ai/text';
const DEFAULT_MODEL = 'openai';

export interface AIConfig {
  apiKey: string;
  model?: string;
}

export class AIClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: AIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const combined = `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n\n[USER REQUEST]\n${userPrompt}`;
    const url = `${BASE}/${encodeURIComponent(combined)}?model=${encodeURIComponent(this.model)}`;

    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'text/plain',
          },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(
            `Pollinations HTTP ${res.status}: ${body.slice(0, 200)}`,
          );
        }
        const text = await res.text();
        const trimmed = text.trim();
        if (!trimmed) {
          throw new Error('Pollinations returned empty response');
        }
        return trimmed;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) {
          const wait = 1500 * attempt;
          warn('pollinations retry', {
            attempt,
            waitMs: wait,
            error: e instanceof Error ? e.message : String(e),
          });
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('Pollinations request failed after retries');
  }
}

/** Hapus markdown code fence kalau AI ngebandel kasih ```json...``` */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}
