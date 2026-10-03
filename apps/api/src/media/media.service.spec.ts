import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { MediaService, validateLadder, validateSubtitles, type RenditionInput } from './media.service';

/**
 * Mirrors supabase/tests/80_media_pipeline.sql and 90_media_subtitles.sql:
 * host-only uploads at a server-fixed path, submit checks the object,
 * worker-only transitions with the SDR-fallback invariant, subtitles only
 * for videos with audio, and live recordings filed once per session.
 */
describe('MediaService', () => {
  const sdr: RenditionInput = { label: '720p', width: 1280, height: 720, bitrate_kbps: 2800, codecs: 'avc1.64001f', dynamic_range: 'sdr', playlist_path: 'a1/720p/index.m3u8' };
  const hdr: RenditionInput = { label: '2160p_hdr', width: 3840, height: 2160, bitrate_kbps: 16000, codecs: 'hvc1.2.4.L153.B0', dynamic_range: 'hdr10', playlist_path: 'a1/2160p_hdr/index.m3u8' };

  it('requires an SDR fallback and paths inside the asset folder', () => {
    expect(() => validateLadder('a1', 'a1/master.m3u8', [hdr])).toThrow('sdr_fallback_required');
    expect(() => validateLadder('a1', 'other/master.m3u8', [sdr])).toThrow('invalid_path');
    expect(() => validateLadder('a1', 'a1/master.m3u8', [{ ...sdr, playlist_path: 'x/720p.m3u8' }])).toThrow('invalid_path');
    expect(() => validateLadder('a1', 'a1/master.m3u8', [])).toThrow('no_renditions');
    expect(() => validateLadder('a1', 'a1/master.m3u8', [hdr, sdr])).not.toThrow();
  });

  it('subtitles need exactly one source-language track', () => {
    const track = (language: string, is_source: boolean) => ({ language, name: language, is_source, vtt_path: `a1/subs/${language}.vtt`, playlist_path: `a1/subs/${language}.m3u8` });
    expect(() => validateSubtitles('a1', [track('en', false)])).toThrow('one_source_track_required');
    expect(() => validateSubtitles('a1', [track('ur', true), track('en', false)])).not.toThrow();
    expect(() => validateSubtitles('a1', [])).not.toThrow(); // no speech
  });

  function build(opts: { host?: unknown; user?: unknown; pending?: number; asset?: unknown; uploaded?: number | null; settings?: object; room?: unknown } = {}) {
    const tx = {
      mediaAsset: {
        create: jest.fn().mockImplementation(({ data }) => ({ status: 'awaiting_upload', ...data })),
        count: jest.fn().mockResolvedValue(opts.pending ?? 0),
        findUnique: jest.fn().mockResolvedValue(opts.asset ?? null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(opts.asset ?? {}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(({ data }) => ({ ...(opts.asset as object), ...data })),
      },
      mediaRendition: { deleteMany: jest.fn(), createMany: jest.fn() },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(opts.user ?? { id: 'h1', status: 'active' }) },
      host: { findUnique: jest.fn().mockResolvedValue(opts.host === undefined ? { userId: 'h1', status: 'active' } : opts.host) },
      platformSetting: { findUnique: jest.fn().mockResolvedValue(opts.settings ? { value: opts.settings } : null) },
      room: { findUnique: jest.fn().mockResolvedValue(opts.room ?? null) },
      stream: { findFirst: jest.fn().mockResolvedValue({ id: 's1', title: 'Friday chat' }) },
    };
    const prisma = { ...tx, $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
    const storage = {
      presignUpload: jest.fn().mockResolvedValue('https://s3.test/put'),
      uploadedSize: jest.fn().mockResolvedValue(opts.uploaded === undefined ? 1024 : opts.uploaded),
      publicUrl: jest.fn((p: string | null) => (p ? `https://cdn.test/${p}` : null)),
    };
    const jobs = { enqueue: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service: new MediaService(prisma as any, storage as any, jobs as any), tx, storage, jobs };
  }

  it('only active hosts reserve uploads, at <owner>/<asset id>.<ext>', async () => {
    await expect(build({ host: null }).service.createUpload('v1', { title: 'x', extension: 'mp4' })).rejects.toThrow(ForbiddenException);
    await expect(build().service.createUpload('h1', { title: 'x', extension: 'exe' })).rejects.toThrow('invalid_format');
    await expect(build({ pending: 5 }).service.createUpload('h1', { title: 'x', extension: 'mp4' })).rejects.toThrow('too_many_pending');
    await expect(build({ settings: { uploads_enabled: false } }).service.createUpload('h1', { title: 'x', extension: 'mp4' })).rejects.toThrow('uploads_disabled');

    const { service, storage } = build();
    const { asset, uploadUrl } = await service.createUpload('h1', { title: ' Sunset ', extension: 'MOV' });
    expect(asset.sourcePath).toBe(`h1/${asset.id}.mov`);
    expect(asset.title).toBe('Sunset');
    expect(storage.presignUpload).toHaveBeenCalledWith(asset.sourcePath, 'video/quicktime');
    expect(uploadUrl).toBe('https://s3.test/put');
  });

  it('submit checks the object exists and queues exactly one processing job', async () => {
    const asset = { id: 'a1', ownerId: 'h1', status: 'awaiting_upload', sourcePath: 'h1/a1.mp4' };
    await expect(build({ asset }).service.submit('h2', 'a1')).rejects.toThrow(NotFoundException);
    await expect(build({ asset, uploaded: null }).service.submit('h1', 'a1')).rejects.toThrow('upload_missing');
    await expect(build({ asset, uploaded: 3 * 1024 ** 3 }).service.submit('h1', 'a1')).rejects.toThrow('file_too_large');
    const { service, jobs } = build({ asset });
    await service.submit('h1', 'a1');
    expect(jobs.enqueue).toHaveBeenCalledWith('media_process', { asset_id: 'a1' }, 'media_process:a1', undefined, expect.anything());
  });

  it('ready records the ladder, publishes and queues subtitles only for videos with audio', async () => {
    const withAudio = build({ asset: { id: 'a1', ownerId: 'h1', status: 'processing', hasAudio: true, publishedAt: null, title: 'T' } });
    await withAudio.service.internalReady('a1', 'a1/master.m3u8', 'a1/thumb.jpg', [hdr, sdr]);
    expect(withAudio.tx.mediaRendition.createMany).toHaveBeenCalled();
    expect(withAudio.jobs.enqueue).toHaveBeenCalledWith('media_subtitles', { asset_id: 'a1' }, 'media_subtitles:a1', undefined, expect.anything());

    const silent = build({ asset: { id: 'a1', ownerId: 'h1', status: 'processing', hasAudio: false, publishedAt: null, title: 'T' } });
    const ready = await silent.service.internalReady('a1', 'a1/master.m3u8', null, [sdr]);
    expect(ready.status).toBe('ready');
    expect(ready.subtitleStatus).toBeNull();
    expect(silent.jobs.enqueue).not.toHaveBeenCalled();

    await expect(build({ asset: { id: 'a1', status: 'queued' } }).service.internalReady('a1', 'a1/master.m3u8', null, [sdr])).rejects.toThrow('not_processing');
  });

  it('non-owners cannot remove; admin takedowns are audited and the owner told', async () => {
    const asset = { id: 'a1', ownerId: 'h1', status: 'ready' };
    await expect(build({ asset }).service.remove('v1', 'USER', 'a1')).rejects.toThrow(NotFoundException);
    const { service, tx } = build({ asset });
    await service.remove('owner', 'OWNER_ADMIN', 'a1', 'Copyright');
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'media_removed', actorId: 'owner' }) });
    expect(tx.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'h1', type: 'media_removed' }) });
  });

  it('live recordings: once per session, only from the room’s own IVS channel', async () => {
    const room = { id: 'r1', hostId: 'h1', title: 'Room', ivsChannelArn: 'arn:aws:ivs:ap-south-1:123:channel/abcDEF' };
    await expect(build({ room }).service.internalRegisterRecording(room.ivsChannelArn, 'rs1', 'ivs/v1/123/otherChannel/2026/10/1/media/hls/master.m3u8'))
      .rejects.toThrow(BadRequestException);
    const { service, jobs } = build({ room });
    const asset = await service.internalRegisterRecording(room.ivsChannelArn, 'rs1', 'ivs/v1/123/abcDEF/2026/10/1/media/hls/master.m3u8');
    expect(asset).toMatchObject({ ownerId: 'h1', sourceKind: 'live_recording', status: 'queued', title: 'Replay: Friday chat' });
    expect(jobs.enqueue).toHaveBeenCalledWith('media_process', { asset_id: asset.id }, `media_process:${asset.id}`, undefined, expect.anything());

    const again = build({ room, asset: { id: 'existing', recordingRef: 'rs1' } });
    await expect(again.service.internalRegisterRecording(room.ivsChannelArn, 'rs1', 'ivs/v1/123/abcDEF/x.m3u8')).resolves.toMatchObject({ id: 'existing' });
    expect(again.jobs.enqueue).not.toHaveBeenCalled();
  });
});
