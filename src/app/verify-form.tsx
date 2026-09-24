import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { FadeIn } from '@/components/Motion';
import { Button, Card, HostBadge, Row, Screen, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { submitHostApplication, type HostApplicationResult } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';

type PhotoKey = 'cnic_front' | 'cnic_back' | 'selfie';
type Photo = { uri: string; width: number; height: number };

const PHOTOS: { key: PhotoKey; title: string; hint: string; icon: 'card-outline' | 'card' | 'person-circle-outline'; front?: boolean }[] = [
  { key: 'cnic_front', title: 'CNIC front', hint: 'Whole card in frame, no glare', icon: 'card-outline' },
  { key: 'cnic_back', title: 'CNIC back', hint: 'Whole card in frame, no glare', icon: 'card' },
  { key: 'selfie', title: 'Face photo with CNIC', hint: 'Hold your CNIC next to your face, both clear', icon: 'person-circle-outline', front: true },
];

/** 13 digits shown as 00000-0000000-0. */
function formatCnic(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 13);
  if (d.length > 12) return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  if (d.length > 5) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return d;
}

/** Resizes to ≤1600px wide JPEG so each upload stays well under Didit's 5 MB limit. */
async function shrink(uri: string): Promise<Photo> {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
  const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height };
}

async function appendPhoto(form: FormData, key: PhotoKey, photo: Photo) {
  if (Platform.OS === 'web') {
    form.append(key, await (await fetch(photo.uri)).blob(), `${key}.jpg`);
  } else {
    // React Native's FormData accepts { uri, name, type } file parts.
    form.append(key, { uri: photo.uri, name: `${key}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  }
}

/** Host verification form: details + CNIC photos, checked by Didit. Photos are never stored by Zynalive. */
export default function VerifyFormScreen() {
  const supabase = useSupabase();
  const { c, radius } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const { reload } = useProfile();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cnic, setCnic] = useState('');
  const [agency, setAgency] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [photos, setPhotos] = useState<Partial<Record<PhotoKey, Photo>>>({});
  const [capturing, setCapturing] = useState<PhotoKey | null>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HostApplicationResult | null>(null);

  const phoneDigits = phone.replace(/\D/g, '');
  const ok = {
    name: name.trim().length >= 3,
    phone: /^3\d{9}$/.test(phoneDigits),
    cnic: cnic.replace(/\D/g, '').length === 13,
    agency: /^[1-9]\d{3}$/.test(agency),
    photos: PHOTOS.every((p) => !!photos[p.key]),
    agreed,
  };
  const complete = [ok.name, ok.phone, ok.cnic, ok.agency, ...PHOTOS.map((p) => !!photos[p.key])].filter(Boolean).length;
  const total = 7;

  const take = async (p: (typeof PHOTOS)[number]) => {
    setCapturing(p.key);
    try {
      let picked: ImagePicker.ImagePickerResult;
      if (Platform.OS === 'web') {
        picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera needed', 'Allow camera access for Zynalive in your device settings to take these photos.');
          return;
        }
        picked = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          cameraType: p.front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        });
      }
      if (picked.canceled || !picked.assets[0]) return;
      const shrunk = await shrink(picked.assets[0].uri);
      setPhotos((prev) => ({ ...prev, [p.key]: shrunk }));
      setError(null);
    } catch (e) {
      Alert.alert('Photo', friendlyError(e));
    } finally {
      setCapturing(null);
    }
  };

  const submit = async () => {
    setTried(true);
    if (!ok.name) return setError('Enter your full name as on your CNIC.');
    if (!ok.phone) return setError('Enter a valid mobile number, e.g. 300 1234567.');
    if (!ok.cnic) return setError('CNIC number must be 13 digits.');
    if (!ok.photos) return setError('Add all three photos.');
    if (!ok.agency) return setError('Enter your agency’s 4-digit code.');
    if (!ok.agreed) return setError('Tick the box to agree to verification by Didit.');
    setError(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('full_name', name.trim());
      form.append('phone', phoneDigits);
      form.append('cnic', cnic.replace(/\D/g, ''));
      form.append('agency_code', agency);
      for (const p of PHOTOS) await appendPhoto(form, p.key, photos[p.key]!);
      const res = await submitHostApplication(supabase, form);
      track('host_application_submitted', { status: res.status });
      setResult(res);
      void reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) return <ResultView result={result} firstName={name.trim().split(/\s+/)[0] ?? ''} cnicLast={cnic.replace(/\D/g, '').slice(-4)} onRetry={() => setResult(null)} />;

  const inputStyle = (valid: boolean) => ({
    height: 50, borderRadius: radius[12] + 2, borderWidth: 1, backgroundColor: c.surface, color: c.text, paddingHorizontal: 16, fontSize: 16, fontFamily: fonts.regular,
    borderColor: tried && !valid ? c.danger : valid ? c.success : c.border,
  });

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ height: 4, marginHorizontal: 16, borderRadius: 2, backgroundColor: c.divider, overflow: 'hidden' }} accessibilityLabel={`${complete} of ${total} complete`}>
          <View style={{ height: 4, width: `${Math.round((complete / total) * 100)}%`, backgroundColor: c.primary }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <FadeIn>
            <Text muted>Fill in your details exactly as they appear on your CNIC. {complete} of {total} complete.</Text>
          </FadeIn>

          <FadeIn delay={50} style={{ gap: 14 }}>
            <Text variant="h3">Your details</Text>
            <Field label="Full name (as on CNIC)">
              <TextInput value={name} onChangeText={setName} placeholder="e.g. Ayesha Khan" placeholderTextColor={c.textFaint} autoComplete="name" style={inputStyle(ok.name)} accessibilityLabel="Full name as on CNIC" />
            </Field>
            <Field label="Phone number">
              <Row gap={8}>
                <View style={{ height: 50, paddingHorizontal: 14, borderRadius: radius[12] + 2, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, justifyContent: 'center' }}>
                  <Text>+92</Text>
                </View>
                <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/[^0-9 ]/g, '').slice(0, 12))} placeholder="300 1234567" placeholderTextColor={c.textFaint} keyboardType="phone-pad" autoComplete="tel" style={[inputStyle(ok.phone), { flex: 1 }]} accessibilityLabel="Phone number" />
              </Row>
            </Field>
            <Field label="CNIC number">
              <TextInput value={cnic} onChangeText={(v) => setCnic(formatCnic(v))} placeholder="35202-1234567-1" placeholderTextColor={c.textFaint} keyboardType="number-pad" style={[inputStyle(ok.cnic), { letterSpacing: 1 }]} accessibilityLabel="CNIC number" />
            </Field>
          </FadeIn>

          <FadeIn delay={100} style={{ gap: 12 }}>
            <Text variant="h3">Photos</Text>
            {PHOTOS.map((p) => {
              const photo = photos[p.key];
              const bad = tried && !photo;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => take(p)}
                  disabled={!!capturing || submitting}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}. ${photo ? 'Photo added. Tap to retake.' : 'Tap to take photo.'}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: radius[16], backgroundColor: c.surface,
                    borderWidth: 1, borderStyle: photo ? 'solid' : 'dashed', borderColor: photo ? c.success : bad ? c.danger : c.border, opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View style={{ width: 76, height: 56, borderRadius: 10, backgroundColor: c.surfaceRaised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {photo ? <Image source={photo.uri} style={{ width: 76, height: 56 }} contentFit="cover" /> : <Ionicons name={p.icon} size={26} color={c.gold} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label">{p.title}</Text>
                    <Text variant="caption" muted>{p.hint}</Text>
                  </View>
                  <Text variant="label" color={photo ? c.success : c.primary} style={{ fontSize: 13 }}>
                    {capturing === p.key ? '…' : photo ? 'Retake' : 'Add photo'}
                  </Text>
                </Pressable>
              );
            })}
          </FadeIn>

          <FadeIn delay={150}>
            <Field label="Agency code">
              <TextInput value={agency} onChangeText={(v) => setAgency(v.replace(/\D/g, '').slice(0, 4))} placeholder="4-digit code, e.g. 4821" placeholderTextColor={c.textFaint} keyboardType="number-pad" maxLength={4} autoCorrect={false} style={[inputStyle(ok.agency), { letterSpacing: 4 }]} accessibilityLabel="Agency code, 4 digits" />
            </Field>
            <Text variant="caption" faint style={{ marginTop: 6 }}>Ask your agency for its 4-digit code.</Text>
          </FadeIn>

          <Pressable onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: agreed ? c.primary : tried ? c.danger : c.border, backgroundColor: agreed ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              {agreed && <Ionicons name="checkmark" size={16} color="#fff" />}
            </View>
            <Text variant="bodySmall" style={{ flex: 1 }}>
              I agree to Didit checking my CNIC and face photo to verify my identity for hosting.{' '}
              <Text variant="bodySmall" color={c.primary} accessibilityRole="link" onPress={() => router.push('/privacy')}>Privacy policy</Text>
            </Text>
          </Pressable>

          {error && <Text color={c.danger} accessibilityLiveRegion="polite">{error}</Text>}
          <Button title={submitting ? 'Submitting to Didit…' : 'Submit for verification'} onPress={submit} loading={submitting} disabled={offline || !!capturing} />
          {offline && <Text variant="caption" muted style={{ textAlign: 'center' }}>You need a connection to submit.</Text>}
          <Text variant="caption" faint style={{ textAlign: 'center' }}>
            Sent securely to Didit for verification. Zynalive keeps only your name, phone, agency code, the last 4 CNIC digits and the result — never your photos.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="bodySmall" muted style={{ fontWeight: '500' }}>{label}</Text>
      {children}
    </View>
  );
}

function ResultView({ result, firstName, cnicLast, onRetry }: { result: HostApplicationResult; firstName: string; cnicLast: string; onRetry: () => void }) {
  const { c } = useTheme();
  const copy = {
    approved: { icon: 'checkmark' as const, color: c.success, bg: c.success, title: 'You’re verified!', body: `Welcome aboard${firstName ? `, ${firstName}` : ''}. Your Host badge is unlocked — you can go live now.` },
    in_review: { icon: 'time-outline' as const, color: c.gold, bg: c.gold, title: 'Submitted for review', body: `Thanks${firstName ? `, ${firstName}` : ''}. Our team is checking your details — usually within a day. We’ll notify you.` },
    declined: { icon: 'close' as const, color: c.danger, bg: c.danger, title: 'We couldn’t verify you', body: 'Make sure your CNIC is valid and fully in frame, your face and card are clear in the photo, and your details match the card exactly.' },
  }[result.status];
  return (
    <Screen edges={['bottom']}>
      <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <FadeIn from={0}>
          <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: copy.color, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}>
            <Ionicons name={copy.icon} size={44} color={copy.color} />
          </View>
        </FadeIn>
        <FadeIn delay={150} style={{ alignItems: 'center', gap: 8 }}>
          <Row gap={8}>
            <Text variant="h2" style={{ textAlign: 'center' }}>{copy.title}</Text>
            {result.status === 'approved' && <HostBadge />}
          </Row>
          <Text muted style={{ textAlign: 'center', maxWidth: 320 }}>{copy.body}</Text>
        </FadeIn>
        <FadeIn delay={250} style={{ alignSelf: 'stretch', maxWidth: 420, width: '100%' }}>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text muted>CNIC</Text>
            <Text>•••••-•••••••-{cnicLast}</Text>
          </Card>
        </FadeIn>
        <FadeIn delay={320} style={{ alignSelf: 'stretch', maxWidth: 420, width: '100%', gap: 10 }}>
          {result.status === 'approved' && <Button title="Go live" onPress={() => router.replace('/create')} />}
          {result.status === 'declined' && <Button title="Try again" onPress={onRetry} />}
          <Button title="Back to Hosting" variant={result.status === 'approved' ? 'ghost' : 'secondary'} onPress={() => router.back()} />
        </FadeIn>
      </View>
    </Screen>
  );
}
