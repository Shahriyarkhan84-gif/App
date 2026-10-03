import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DynamicRange, MediaAsset, Prisma } from '@zynalive/database';

import { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from './media-storage.service';

export const VIDEO_EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska',
};
const DYNAMIC_RANGES: DynamicRange[] = ['sdr', 'hdr10', 'hlg'];

export type MediaSettings = {
  uploads_enabled: boolean;
  hdr_enabled: boolean;
  uhd_enabled: boolean;
  subtitles_enabled: boolean;
  subtitle_languages: string[];
  max_upload_mb: number;
  max_duration_s: number;
  max_pending_uploads: number;
};
// Defaults match the seed in 20260925010000_media_pipeline.sql / 20260925020000_media_subtitles.sql.
export const MEDIA_DEFAULTS: MediaSettings = {
  uploads_enabled: true, hdr_enabled: true, uhd_enabled: true, subtitles_enabled: true,
  subtitle_languages: ['en', 'ur', 'hi', 'bn'], max_upload_mb: 2048, max_duration_s: 3600, max_pending_uploads: 5,
};

export type RenditionInput = {
  label: string; width: number; height: number; bitrate_kbps: number; codecs: string; dynamic_range: DynamicRange; playlist_path: string;
};
export type SubtitleInput = { language: string; name: string; is_source: boolean; vtt_path: string; playlist_path: string };

/** Mirrors the checks in internal_media_ready(): non-empty, SDR fallback, paths under the asset. */
export function validateLadder(assetId: string, playbackPath: string, renditions: RenditionInput[]) {
  if (!renditions.length) throw new BadRequestException('no_renditions');
  if (!renditions.some((r) => r.dynamic_range === 'sdr')) throw new BadRequestException('sdr_fallback_required');
  if (playbackPath.split('/')[0] !== assetId) throw new BadRequestException('invalid_path');
  for (const r of renditions) {
    if (!/^[0-9]{3,4}p(_hdr)?$/.test(r.label) || !DYNAMIC_RANGES.includes(r.dynamic_range)) throw new BadRequestException('invalid_rendition');
    if (r.playlist_path.split('/')[0] !== assetId) throw new BadRequestException('invalid_path');
  }
}

/** Mirrors internal_media_subtitles(): empty (no speech) or exactly one source track, paths under the asset. */
export function validateSubtitles(assetId: string, tracks: SubtitleInput[]) {
  if (tracks.length && tracks.filter((t) => t.is_source).length !== 1) throw new BadRequestException('one_source_track_required');
  for (const t of tracks) {
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(t.language)) throw new BadRequestException('invalid_language');
    if (t.vtt_path.split('/')[0] !== assetId || t.playlist_path.split('/')[0] !== assetId) throw new BadRequestException('invalid_path');
  }
}

/**
 * Upload + HDR pipeline, translated from 20260925010000_media_pipeline.sql.
 * Clients reserve an upload (the server fixes the S3 key), PUT the file to a
 * presigned URL, then submit; the media worker probes, detects HDR and
 * encodes the ladder, reporting back through the internal endpoints below.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
    private readonly jobs: AiJobsService,
  ) {}

  async settings(): Promise<MediaSettings> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: 'media' } });
    return { ...MEDIA_DEFAULTS, ...((row?.value as Partial<MediaSettings> | undefined) ?? {}) };
  }

  private isAdmin(role: string) {
    return (PLATFORM_ADMIN_ROLES as string[]).includes(role);
  }

  withUrls<T extends Pick<MediaAsset, 'playbackPath' | 'thumbnailPath'>>(asset: T) {
    return { ...asset, playbackUrl: this.storage.publicUrl(asset.playbackPath), thumbnailUrl: this.storage.publicUrl(asset.thumbnailPath) };
  }

  // Clients ------------------------------------------------------------------------

  async createUpload(userId: string, input: { title: string; extension: string; description?: string | null; visibility?: string }) {
    const [user, host, settings] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.host.findUnique({ where: { userId } }),
      this.settings(),
    ]);
    if (user.status !== 'active') throw new ForbiddenException('account_restricted');
    if (!host || host.status !== 'active') throw new ForbiddenException('not_a_host');
    if (!settings.uploads_enabled) throw new BadRequestException('uploads_disabled');
    const ext = input.extension.toLowerCase();
    if (!VIDEO_EXTENSIONS[ext]) throw new BadRequestException('invalid_format');
    const title = input.title.trim();
    if (!title) throw new BadRequestException('title_required');
    const visibility = input.visibility ?? 'public';
    if (visibility !== 'public' && visibility !== 'unlisted') throw new BadRequestException('invalid_visibility');
    const pending = await this.prisma.mediaAsset.count({ where: { ownerId: userId, status: { in: ['awaiting_upload', 'queued', 'processing'] } } });
    if (pending >= settings.max_pending_uploads) throw new BadRequestException('too_many_pending');

    const id = randomUUID();
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id, ownerId: userId, title: title.slice(0, 100), description: input.description?.trim().slice(0, 500) || null,
        visibility, sourcePath: `${userId}/${id}.${ext}`,
      },
    });
    const uploadUrl = await this.storage.presignUpload(asset.sourcePath, VIDEO_EXTENSIONS[ext]);
    return { asset, uploadUrl, contentType: VIDEO_EXTENSIONS[ext] };
  }

  async submit(userId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.ownerId !== userId) throw new NotFoundException('not_found');
    if (asset.status !== 'awaiting_upload') throw new BadRequestException('already_submitted');
    const size = await this.storage.uploadedSize(asset.sourcePath);
    if (size === null) throw new BadRequestException('upload_missing');
    if (size > (await this.settings()).max_upload_mb * 1024 * 1024) throw new BadRequestException('file_too_large');

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.mediaAsset.updateMany({ where: { id: assetId, status: 'awaiting_upload' }, data: { status: 'queued' } });
      if (!count) throw new BadRequestException('already_submitted');
      await this.jobs.enqueue('media_process', { asset_id: assetId }, `media_process:${assetId}`, undefined, tx);
      return tx.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    });
  }

  async update(userId: string, assetId: string, input: { title: string; description?: string | null; visibility: string }) {
    if (input.visibility !== 'public' && input.visibility !== 'unlisted') throw new BadRequestException('invalid_visibility');
    if (!input.title.trim()) throw new BadRequestException('title_required');
    const { count } = await this.prisma.mediaAsset.updateMany({
      where: { id: assetId, ownerId: userId, status: { not: 'removed' } },
      data: { title: input.title.trim().slice(0, 100), description: input.description?.trim().slice(0, 500) || null, visibility: input.visibility },
    });
    if (!count) throw new NotFoundException('not_found');
    return this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  }

  /** Owner deletes, or a platform admin takes it down (audited, owner notified). */
  async remove(actorId: string, actorRole: string, assetId: string, reason?: string | null) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || (asset.ownerId !== actorId && !this.isAdmin(actorRole))) throw new NotFoundException('not_found');
    const removed = await this.prisma.mediaAsset.update({ where: { id: assetId }, data: { status: 'removed' } });
    if (asset.ownerId !== actorId) {
      await this.prisma.auditLog.create({ data: { actorId, action: 'media_removed', targetType: 'media', targetId: assetId, details: { reason: reason ?? null } } });
      await this.prisma.notification.create({
        data: { userId: asset.ownerId, type: 'media_removed', title: 'Video removed', body: reason ?? 'It broke the community rules.', data: { asset_id: assetId } },
      });
    }
    return removed;
  }

  /** Ready media by id (also unlisted); owners and admins see any state. Mirrors get_media(). */
  async get(viewerId: string, viewerRole: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      include: { renditions: true, subtitles: true, owner: { include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true, status: true } } } } },
    });
    if (!asset) throw new NotFoundException('not_found');
    const privileged = asset.ownerId === viewerId || this.isAdmin(viewerRole);
    if (!privileged && (asset.status !== 'ready' || asset.owner.user.status === 'banned')) throw new NotFoundException('not_found');
    const { owner, ...rest } = asset;
    return { ...this.withUrls(rest), owner: { id: owner.user.id, displayName: owner.user.displayName, username: owner.user.username, avatarUrl: owner.user.avatarUrl } };
  }

  async listPublic(limit = 60) {
    const rows = await this.prisma.mediaAsset.findMany({
      where: { status: 'ready', visibility: 'public', owner: { user: { status: { not: 'banned' } } } },
      orderBy: { publishedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => this.withUrls(r));
  }

  async listMine(userId: string) {
    const rows = await this.prisma.mediaAsset.findMany({ where: { ownerId: userId, status: { not: 'removed' } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => this.withUrls(r));
  }

  /** One view per signed-in user. */
  async recordView(userId: string, assetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findFirst({ where: { id: assetId, status: 'ready' } });
      if (!asset) throw new NotFoundException('not_found');
      const inserted = await tx.mediaView.createMany({ data: [{ assetId, userId }], skipDuplicates: true });
      if (inserted.count) {
        return (await tx.mediaAsset.update({ where: { id: assetId }, data: { viewCount: { increment: 1 } } })).viewCount;
      }
      return asset.viewCount;
    });
  }

  // Worker (internal) ----------------------------------------------------------------

  async internalStarted(assetId: string) {
    const { count } = await this.prisma.mediaAsset.updateMany({
      where: { id: assetId, status: { in: ['queued', 'processing', 'failed'] } }, data: { status: 'processing', error: null },
    });
    if (!count) throw new BadRequestException('not_processable');
    return this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  }

  async internalProbed(assetId: string, probe: Record<string, unknown>) {
    const range = probe.dynamic_range as DynamicRange;
    if (!DYNAMIC_RANGES.includes(range)) throw new BadRequestException('invalid_dynamic_range');
    const num = (k: string) => (probe[k] == null ? null : Number(probe[k]));
    const str = (k: string) => (probe[k] == null ? null : String(probe[k]));
    const { count } = await this.prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'processing' },
      data: {
        durationMs: probe.duration_ms == null ? null : BigInt(Math.round(Number(probe.duration_ms))),
        width: num('width'), height: num('height'), fps: num('fps'), bitDepth: num('bit_depth'),
        videoCodec: str('video_codec'), colorPrimaries: str('color_primaries'), colorTransfer: str('color_transfer'), colorSpace: str('color_space'),
        dynamicRange: range, hdrMetadata: (probe.hdr_metadata ?? undefined) as Prisma.InputJsonValue | undefined, hasAudio: probe.has_audio === true,
      },
    });
    if (!count) throw new BadRequestException('not_processing');
    return this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  }

  async internalReady(assetId: string, playbackPath: string, thumbnailPath: string | null, renditions: RenditionInput[]) {
    validateLadder(assetId, playbackPath, renditions);
    const settings = await this.settings();
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findUnique({ where: { id: assetId } });
      if (!asset || asset.status !== 'processing') throw new BadRequestException('not_processing');
      await tx.mediaRendition.deleteMany({ where: { assetId } });
      await tx.mediaRendition.createMany({
        data: renditions.map((r) => ({
          assetId, label: r.label, width: r.width, height: r.height, bitrateKbps: r.bitrate_kbps, codecs: r.codecs,
          dynamicRange: r.dynamic_range, playlistPath: r.playlist_path,
        })),
      });
      const wantsSubtitles = !!asset.hasAudio && settings.subtitles_enabled;
      const ready = await tx.mediaAsset.update({
        where: { id: assetId },
        data: {
          status: 'ready', playbackPath, thumbnailPath, error: null, publishedAt: asset.publishedAt ?? new Date(),
          subtitleStatus: wantsSubtitles ? 'pending' : null,
        },
      });
      if (wantsSubtitles) await this.jobs.enqueue('media_subtitles', { asset_id: assetId }, `media_subtitles:${assetId}`, undefined, tx);
      await tx.notification.create({ data: { userId: ready.ownerId, type: 'media_ready', title: 'Your video is ready', body: ready.title, data: { asset_id: assetId } } });
      return ready;
    });
  }

  async internalFailed(assetId: string, error: string) {
    const { count } = await this.prisma.mediaAsset.updateMany({
      where: { id: assetId, status: { in: ['queued', 'processing'] } }, data: { status: 'failed', error: error.slice(0, 500) },
    });
    const asset = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    if (count) {
      await this.prisma.notification.create({ data: { userId: asset.ownerId, type: 'media_failed', title: 'Video processing failed', body: asset.title, data: { asset_id: assetId } } });
    }
    return asset;
  }

  async internalSubtitles(assetId: string, tracks: SubtitleInput[] | null, failed = false) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== 'ready') throw new BadRequestException('not_ready');
    if (failed) return this.prisma.mediaAsset.update({ where: { id: assetId }, data: { subtitleStatus: 'failed' } });
    const list = tracks ?? [];
    validateSubtitles(assetId, list);
    return this.prisma.$transaction(async (tx) => {
      await tx.mediaSubtitle.deleteMany({ where: { assetId } });
      if (list.length) {
        await tx.mediaSubtitle.createMany({
          data: list.map((t) => ({ assetId, language: t.language, name: t.name.slice(0, 40), isSource: t.is_source, vttPath: t.vtt_path, playlistPath: t.playlist_path })),
        });
      }
      return tx.mediaAsset.update({ where: { id: assetId }, data: { subtitleStatus: list.length ? 'done' : 'no_speech' } });
    });
  }

  /**
   * IVS "Recording End" (EventBridge → internal endpoint): files the replay
   * and queues it through the same pipeline. Idempotent on the recording
   * session; the S3 prefix must belong to the room's own IVS channel.
   */
  async internalRegisterRecording(channelArn: string, recordingSessionId: string, sourcePath: string) {
    const existing = await this.prisma.mediaAsset.findUnique({ where: { recordingRef: recordingSessionId } });
    if (existing) return existing;
    const room = await this.prisma.room.findUnique({ where: { ivsChannelArn: channelArn } });
    if (!room) throw new NotFoundException('room_not_found');
    const channelId = channelArn.split('/').pop();
    if (!channelId || !sourcePath.split('/').includes(channelId)) throw new BadRequestException('invalid_path');
    const stream = await this.prisma.stream.findFirst({ where: { roomId: room.id }, orderBy: { startedAt: 'desc' } });
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          id: randomUUID(), ownerId: room.hostId, sourceKind: 'live_recording', streamId: stream?.id ?? null, recordingRef: recordingSessionId,
          title: `Replay: ${stream?.title ?? room.title}`.slice(0, 100), sourcePath, status: 'queued',
        },
      });
      await this.jobs.enqueue('media_process', { asset_id: asset.id }, `media_process:${asset.id}`, undefined, tx);
      return asset;
    });
  }
}
