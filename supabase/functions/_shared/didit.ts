import { HttpError, requireEnv } from './cors.ts';

const BASE = 'https://verification.didit.me/v3';

async function didit(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-api-key': requireEnv('DIDIT_API_KEY'), 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    console.error('Didit API error', path, res.status, await res.text().catch(() => ''));
    throw new HttpError(502, 'verification_unavailable', 'Verification service unavailable');
  }
  return res.json();
}

export async function createSession(opts: { vendorData: string; callback?: string; language?: string }) {
  return (await didit('/session/', {
    method: 'POST',
    body: JSON.stringify({
      workflow_id: requireEnv('DIDIT_WORKFLOW_ID'),
      vendor_data: opts.vendorData,
      ...(opts.callback ? { callback: opts.callback } : {}),
      ...(opts.language ? { language: opts.language } : {}),
    }),
  })) as { session_id: string; url: string; status: string };
}

type Decision = {
  status: string;
  id_verifications?: { status?: string; document_type?: string; issuing_country?: string }[];
  liveness_checks?: { status?: string }[];
  face_matches?: { status?: string }[];
};

/** Reads the authoritative decision from Didit and keeps only non-PII fields. */
export async function getDecisionSummary(sessionId: string) {
  const d = (await didit(`/session/${encodeURIComponent(sessionId)}/decision/`)) as Decision;
  const id = d.id_verifications?.[0];
  return {
    status: d.status,
    summary: {
      id_status: id?.status ?? null,
      document_type: id?.document_type ?? null,
      issuing_country: id?.issuing_country ?? null,
      liveness_status: d.liveness_checks?.[0]?.status ?? null,
      face_match_status: d.face_matches?.[0]?.status ?? null,
    },
  };
}

// Webhook signatures ------------------------------------------------------------------------

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Canonical JSON used by Didit's X-Signature: keys sorted recursively, compact
 * separators, non-ASCII unescaped (Python json.dumps(sort_keys=True,
 * ensure_ascii=False, separators=(",", ":")) with whole floats as ints —
 * JSON.parse already yields 1 for 1.0, so JSON.stringify matches).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export type DiditWebhook = { session_id: string; status: string; webhook_type: string; vendor_data?: string; event_id?: string };

/**
 * Verifies a Didit webhook. Accepts X-Signature (HMAC of `{timestamp}:{canonical body}`)
 * or, as Didit's documented fallback, X-Signature-Simple (HMAC of the key fields).
 * Rejects timestamps more than 5 minutes old.
 */
export async function verifyWebhook(headers: Headers, rawBody: string, secret: string, nowSeconds = Date.now() / 1000) {
  const timestamp = headers.get('x-timestamp') ?? '';
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return null;

  let body: DiditWebhook;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const signature = headers.get('x-signature');
  if (signature && timingSafeEqual(await hmacHex(secret, `${timestamp}:${canonicalJson(body)}`), signature)) return body;

  const simple = headers.get('x-signature-simple');
  if (simple) {
    const expected = await hmacHex(secret, `${timestamp}:${body.session_id}:${body.status}:${body.webhook_type}`);
    if (timingSafeEqual(expected, simple)) return body;
  }
  return null;
}
