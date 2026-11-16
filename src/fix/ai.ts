import { buildChanges, isSmallEdit } from './engine';
import { diffLines } from './diff';
import type { Diag, FixEnv, FixResult } from './types';

/** The optional AI tier. The key lives only in this browser's localStorage and goes only to the provider. */

export type Provider = 'anthropic' | 'openai';
export interface AiSettings {
  provider: Provider;
  apiKey: string;
  model: string;
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
};
export const PROVIDER_HOSTS: Record<Provider, string> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
};

const KEY = 'pypal:ai';

export function loadAiSettings(): AiSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<AiSettings>;
    if (typeof v.apiKey !== 'string' || !v.apiKey.trim()) return null;
    const provider: Provider = v.provider === 'openai' ? 'openai' : 'anthropic';
    return { provider, apiKey: v.apiKey.trim(), model: typeof v.model === 'string' && v.model.trim() ? v.model.trim() : DEFAULT_MODELS[provider] };
  } catch {
    return null; // corrupted storage is treated as "no key"
  }
}

export function saveAiSettings(s: AiSettings | null): boolean {
  try {
    if (!s) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

const SYSTEM = [
  'You fix Python code written by absolute beginners.',
  'Make the smallest change that fixes the problem. Keep the student\'s variable names, comments, spacing and style.',
  'Never delete working code, never add features, never rewrite code that already works.',
  'Reply with JSON only, no prose and no code fences: {"code": "<the full corrected file>", "notes": [{"line": <line number in the corrected file>, "reason": "<one short plain-English sentence>"}]}',
  'If you cannot fix it safely, reply {"code": null, "notes": []}.',
].join(' ');

export function buildPrompt(code: string, diag: Diag): string {
  const where = diag.lineno ? ` on line ${diag.lineno}` : '';
  return `This Python program fails with ${diag.type}: ${diag.message}${where}.\n\nProgram:\n${code}`;
}

export interface AiReply {
  code: string;
  notes: { line: number; reason: string }[];
}

export function parseAiReply(text: string): AiReply | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1)) as { code?: unknown; notes?: unknown };
    if (typeof v.code !== 'string' || !v.code.trim()) return null;
    const notes = Array.isArray(v.notes)
      ? v.notes.flatMap((n) => {
          const o = n as { line?: unknown; reason?: unknown };
          return typeof o.line === 'number' && typeof o.reason === 'string' ? [{ line: o.line, reason: o.reason.slice(0, 160) }] : [];
        })
      : [];
    return { code: v.code, notes };
  } catch {
    return null;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Ask the model. Errors never include the key. Returns null on any failure. */
export async function askModel(settings: AiSettings, code: string, diag: Diag, fetchFn: FetchLike = (u, i) => fetch(u, i), signal?: AbortSignal): Promise<AiReply | null> {
  const prompt = buildPrompt(code, diag);
  try {
    let res: Response;
    if (settings.provider === 'anthropic') {
      res = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: settings.model, max_tokens: 4096, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
      });
    } else {
      res = await fetchFn('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: settings.model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
      });
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[]; choices?: { message?: { content?: string } }[] };
    const text = settings.provider === 'anthropic' ? data.content?.map((c) => c.text ?? '').join('') : data.choices?.[0]?.message?.content;
    return text ? parseAiReply(text) : null;
  } catch {
    return null;
  }
}

/**
 * Run the model's answer through the same verification as the rules tier: it must compile,
 * the program must no longer raise, and it must be a small edit (no silent rewrites or deletions).
 */
export async function verifyAiFix(original: string, reply: AiReply, env: FixEnv, scope?: { from: number; to: number }): Promise<FixResult | null> {
  const code = reply.code.replace(/\r\n/g, '\n');
  if (code === original) return null;
  if (!isSmallEdit(original, code)) return null;
  const remaining = await env.diagnose(code, { run: true });
  if (remaining && remaining.kind === 'syntax') return null;

  if (scope) {
    // Fix selection: every change must stay inside the selected lines.
    const outside = diffLines(original.split('\n'), code.split('\n')).some((h) => h.aStart + 1 < scope.from || h.aEnd > scope.to || (h.aStart === h.aEnd && (h.aStart < scope.from - 1 || h.aStart > scope.to)));
    if (outside) return null;
  }
  const noteByLine = new Map(reply.notes.map((n) => [n.line, n.reason]));
  const newLines = code.split('\n');
  const reasons = newLines.map((_, i) => (noteByLine.has(i + 1) ? [noteByLine.get(i + 1)!] : []));
  const changes = buildChanges(original, code, reasons).map((c) => (c.reason === 'Changed to fix the problem' ? { ...c, reason: 'Changed by the AI to fix the problem' } : c));
  // keep the shape consistent even when no per-line notes were returned
  if (!diffLines(original.split('\n'), newLines).length) return null;
  return {
    status: remaining ? 'partial' : 'fixed',
    original,
    code,
    changes,
    steps: [{ rule: 'ai', reason: 'AI suggestion' }],
    remaining,
    initial: null,
    source: 'ai',
  };
}
