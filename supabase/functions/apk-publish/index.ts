// Keeps the website's Android download in the public `downloads` bucket (Expo's artifact links
// expire): copies the EAS build named by platform_settings 'android_apk' -> source into
// downloads/android/zynalive.apk, then writes downloads/android/latest.json (source, size, time).
// zynalive.com/download/android redirects to that file.
// GET or POST /functions/v1/apk-publish takes no input: callers can only trigger the copy an owner
// has already chosen, and once it is done the call just answers "up to date". The copy runs in the
// background (it can take a minute or two), so a call that starts it answers 202.
import { isExpoApkUrl } from '../_shared/apk.ts';
import { corsHeaders, json, requireEnv } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';

const BUCKET = 'downloads';
const APK_PATH = 'android/zynalive.apk';
const META_PATH = 'android/latest.json';
const MAX_BYTES = 300 * 1024 * 1024;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// One copy at a time per worker; a second call meanwhile just reports it is in progress.
let publishing: string | null = null;

async function upload(path: string, body: BodyInit, contentType: string, length?: number) {
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${requireEnv('SUPABASE_URL')}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      // A new-style secret key (sb_secret_…) is not a JWT: send it as `apikey` only, as supabase-js does.
      apikey: key,
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': 'max-age=300',
      ...(length ? { 'Content-Length': String(length) } : {}),
    },
    body,
    // Streamed request bodies need half-duplex.
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
  if (!res.ok) throw new Error(`upload ${path} failed: ${res.status} ${await res.text()}`);
}

async function publish(source: string) {
  const res = await fetch(source, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  console.log(`apk-publish: copying ${length} bytes from ${source}`);
  if (!length || length > MAX_BYTES) throw new Error(`unexpected APK size: ${length}`);
  // The APK is streamed through (it doesn't fit in the function's memory). Check the first bytes:
  // an APK is a zip file, which starts with "PK".
  const reader = res.body.getReader();
  const first = await reader.read();
  if (first.done || first.value[0] !== 0x50 || first.value[1] !== 0x4b) throw new Error('download is not an APK');
  const apk = new ReadableStream<Uint8Array>({
    start: (c) => c.enqueue(first.value),
    pull: async (c) => {
      const { done, value } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  await upload(APK_PATH, apk, 'application/vnd.android.package-archive', length);
  await upload(META_PATH, JSON.stringify({ source, bytes: length, published_at: new Date().toISOString() }), 'application/json');
  console.log(`apk-publish: published ${length} bytes from ${source}`);
}

async function current(): Promise<{ source?: string; bytes?: number; published_at?: string } | null> {
  const { data } = await adminClient().storage.from(BUCKET).download(META_PATH);
  if (!data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: { code: 'method_not_allowed' } }, 405);
  try {
    const { data: setting, error } = await adminClient().from('platform_settings').select('value').eq('key', 'android_apk').maybeSingle();
    if (error) throw error;
    const source = (setting?.value as { source?: unknown } | null)?.source;
    if (!isExpoApkUrl(source)) return json({ error: { code: 'not_configured' } }, 503);

    const published = await current();
    if (published?.source === source) return json({ status: 'up_to_date', ...published });
    if (publishing === source) return json({ status: 'in_progress' }, 202);

    publishing = source;
    EdgeRuntime.waitUntil(
      publish(source)
        .catch((err) => console.error('apk-publish failed:', err))
        .finally(() => (publishing = null)),
    );
    return json({ status: 'started' }, 202);
  } catch (err) {
    console.error(err);
    return json({ error: { code: 'internal' } }, 500);
  }
});
