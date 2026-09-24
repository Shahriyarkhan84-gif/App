export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Consistent error shape: { error: { code, message } }. Never leaks internals. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

// Business-rule exceptions raised by our Postgres RPCs, safe to show clients.
const RPC_ERRORS: Record<string, number> = {
  not_authenticated: 401,
  forbidden: 403,
  account_restricted: 403,
  banned_from_room: 403,
  not_a_host: 403,
  invalid_package: 400,
  room_not_live: 409,
  already_verified: 409,
  verification_required: 403,
};

/** Converts a Supabase RPC error into an HttpError (known codes) or rethrows. */
export function rpcError(error: { message?: string } | null): never {
  const code = error?.message ?? 'rpc_failed';
  if (code in RPC_ERRORS) throw new HttpError(RPC_ERRORS[code], code);
  throw new Error(`RPC failed: ${code}`);
}

/** Wraps a handler with CORS preflight and uniform JSON errors; details are logged server-side only. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Use POST' } }, 405);
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status);
      console.error(err);
      return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
    }
  };
}

export function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, 'not_configured', `${name} is not configured`);
  return value;
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}
