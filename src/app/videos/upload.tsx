import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { resolveState, StateView, type ViewState } from '@/components/StateView';
import { Button, Card, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { VideoCard } from '@/components/VideoCard';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { fetchMediaBase, MEDIA_SELECT, videoExtension, videoMime, type MediaAsset } from '@/lib/media';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type Settings = { uploads_enabled?: boolean; max_upload_mb?: number; max_duration_s?: number };

/**
 * Host uploads: reserve → upload to uploads/<own id>/ → submit. Processing
 * (HDR detection, 4K/1080p HDR + SDR ladder) happens server-side; status
 * updates arrive in realtime.
 */
export default function UploadScreen() {
  const supabase = useSupabase();
  const offline = useOffline();
  const track = useAnalytics();
  const { c, hPadding } = useTheme();
  const { profile, isHost } = useProfile();
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [uploading, setUploading] = useState(false);
  const [permission, requestPermission] = ImagePicker.useMediaLibraryPermissions();

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    if (!profile) return undefined;
    const [base, mine, setting] = await Promise.all([
      fetchMediaBase(supabase),
      supabase.from('media_assets').select(MEDIA_SELECT).eq('owner_id', profile.id).neq('status', 'removed')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('platform_settings').select('value').eq('key', 'media').maybeSingle(),
    ]);
    if (mine.error) throw mine.error;
    return { base, mine: (mine.data ?? []) as MediaAsset[], settings: (setting.data?.value ?? {}) as Settings };
  }, [profile?.id]);

  useRealtime('media_assets', profile ? `owner_id=eq.${profile.id}` : undefined, () => reload(), !!profile);

  const maxMb = data?.settings.max_upload_mb ?? 2048;
  const maxMin = Math.round((data?.settings.max_duration_s ?? 3600) / 60);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (!videoExtension(asset.uri, asset.mimeType)) return Alert.alert('Unsupported video', 'Use an MP4, MOV, M4V, WebM or MKV file.');
    if (asset.fileSize && asset.fileSize > maxMb * 1024 * 1024) return Alert.alert('Video too large', `Videos can be up to ${maxMb} MB.`);
    if (asset.duration && asset.duration > maxMin * 60 * 1000) return Alert.alert('Video too long', `Videos can be up to ${maxMin} minutes.`);
    setPicked(asset);
    if (!title && asset.fileName) setTitle(asset.fileName.replace(/\.[^.]+$/, '').slice(0, 100));
  };

  const upload = async () => {
    if (!picked) return;
    const ext = videoExtension(picked.uri, picked.mimeType)!;
    setUploading(true);
    try {
      const asset = await rpc<MediaAsset>(supabase, 'create_media_upload', {
        p_title: title.trim(), p_extension: ext, p_description: description.trim() || null, p_visibility: visibility,
      });
      // Blob keeps the file on the native side instead of copying it into JS memory.
      const body = await (await fetch(picked.uri)).blob();
      const { error: upErr } = await supabase.storage.from('uploads').upload(asset.source_path, body, { contentType: videoMime(ext) });
      if (upErr) throw upErr;
      await rpc(supabase, 'submit_media_upload', { p_asset_id: asset.id });
      track('video_uploaded', { ext, visibility });
      setPicked(null);
      setTitle('');
      setDescription('');
      reload();
    } catch (e) {
      Alert.alert('Upload failed', friendlyError(e));
    } finally {
      setUploading(false);
    }
  };

  let state: ViewState = resolveState({ offline, loading, error, data, onRetry: reload });
  if (profile && !isHost) state = { kind: 'disabled', title: 'Uploads are for hosts', body: 'Become a host from the Go live tab to share videos.' };
  else if (profile && profile.status !== 'active') state = { kind: 'disabled', title: 'Uploads are paused', body: 'Your account is currently restricted.' };
  else if (data && data.settings.uploads_enabled === false) state = { kind: 'disabled', title: 'Uploads are paused', body: 'Video uploads are temporarily unavailable.' };
  else if (!profile) state = offline ? { kind: 'offline', onRetry: reload } : { kind: 'loading' };
  else if (state.kind === 'success' && permission && !permission.granted && permission.canAskAgain) {
    state = { kind: 'permission', title: 'Photos & videos', body: 'Allow access to pick a video to upload.', onGrant: () => void requestPermission() };
  }

  return (
    <Screen edges={[]}>
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ padding: hPadding, gap: 16 }}>
          <Card>
            <Text variant="h3">Upload a video</Text>
            <Text muted variant="caption">
              HDR10 and HLG videos keep their HDR, up to 4K. Everyone else gets a standard version automatically. Up to {maxMb} MB, {maxMin} min.
            </Text>
            <Button title={picked ? 'Choose a different video' : 'Choose video'} variant="secondary" onPress={pick} disabled={uploading} />
            {picked && (
              <View style={{ gap: 12 }}>
                <Text variant="caption" muted numberOfLines={1}>{picked.fileName ?? 'Selected video'}</Text>
                <Input label="Title" value={title} onChangeText={setTitle} maxLength={100} />
                <Input label="Description (optional)" value={description} onChangeText={setDescription} maxLength={500} multiline />
                <Row gap={8}>
                  <Chip label="Public" selected={visibility === 'public'} onPress={() => setVisibility('public')} />
                  <Chip label="Unlisted" selected={visibility === 'unlisted'} onPress={() => setVisibility('unlisted')} />
                </Row>
                <Text variant="caption" muted>
                  {visibility === 'public' ? 'Shown in Videos and on your profile.' : 'Only people with the link can watch.'}
                </Text>
                <Button title="Upload" onPress={upload} loading={uploading} disabled={!title.trim()} />
              </View>
            )}
          </Card>

          <Text variant="h3">My videos</Text>
          {data?.mine.length === 0 && <Text muted>Nothing yet — your uploads and live replays appear here.</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {data?.mine.map((v) => (
              <View key={v.id} style={{ width: '47%' }}>
                <VideoCard asset={v} base={data.base} showStatus onPress={() => (v.status === 'ready' ? router.push(`/videos/${v.id}`) : v.error && Alert.alert('Processing failed', friendlyError(new Error(v.error))))} />
              </View>
            ))}
          </View>
          {data?.mine.some((v) => v.status === 'failed') && (
            <Text variant="caption" color={c.textMuted}>Failed videos can be uploaded again.</Text>
          )}
        </ScrollView>
      </StateView>
    </Screen>
  );
}
