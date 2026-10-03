import type { SupabaseClient } from '@supabase/supabase-js';

// Videos from the upload / live-recording pipeline (see docs/ARCHITECTURE.md → Media).

export type DynamicRange = 'sdr' | 'hdr10' | 'hlg';
export type MediaStatus = 'awaiting_upload' | 'queued' | 'processing' | 'ready' | 'failed' | 'removed';

export type MediaAsset = {
  id: string;
  owner_id: string;
  source_kind: 'upload' | 'live_recording';
  title: string;
  description: string | null;
  visibility: 'public' | 'unlisted';
  source_path: string;
  status: MediaStatus;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  dynamic_range: DynamicRange | null;
  playback_path: string | null;
  thumbnail_path: string | null;
  error: string | null;
  view_count: number;
  published_at: string | null;
  created_at: string;
};

export type Rendition = { label: string; width: number; height: number; dynamic_range: DynamicRange };

export const MEDIA_SELECT =
  'id,owner_id,source_kind,title,description,visibility,source_path,status,duration_ms,width,height,dynamic_range,playback_path,thumbnail_path,error,view_count,published_at,created_at';

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv'] as const;

const MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska',
};

export function videoExtension(uri: string, mimeType?: string | null): string | null {
  const fromMime = Object.entries(MIME).find(([, m]) => m === mimeType)?.[0];
  if (fromMime) return fromMime;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export const videoMime = (ext: string) => MIME[ext] ?? 'application/octet-stream';

/** Public base URL of the `media` bucket (platform_settings.media.media_base). */
export async function fetchMediaBase(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from('platform_settings').select('value').eq('key', 'media').maybeSingle();
  const base = (data?.value as { media_base?: string | null } | undefined)?.media_base;
  return base ? base.replace(/\/$/, '') : null;
}

export const mediaUrl = (base: string | null, path: string | null) => (base && path ? `${base}/${path}` : null);

/** "4K HDR" / "HDR" / "HLG" badge for a ready video, from its best rendition. */
export function qualityBadge(asset: Pick<MediaAsset, 'dynamic_range' | 'width' | 'height'>, renditions?: Rendition[]): string | null {
  const hdr = renditions ? renditions.some((r) => r.dynamic_range !== 'sdr') : asset.dynamic_range !== 'sdr' && !!asset.dynamic_range;
  const shortSide = renditions?.length
    ? Math.max(...renditions.map((r) => Math.min(r.width, r.height)))
    : Math.min(asset.width ?? 0, asset.height ?? 0);
  const uhd = shortSide >= 2100;
  if (hdr) return `${uhd ? '4K ' : ''}${asset.dynamic_range === 'hlg' ? 'HLG' : 'HDR'}`;
  return uhd ? '4K' : shortSide >= 1080 ? 'HD' : null;
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
