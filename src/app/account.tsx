import { useClerk, useUser } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as AuthSession from 'expo-auth-session';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { clerkErrorMessage } from '@/components/AuthForm';
import { Button, Card, Input, ListRow, Row, Screen, Text, type IconName } from '@/components/ui';
import { Alert, confirmAction } from '@/lib/alert';
import { brand } from '@/lib/brand';
import { useProfile } from '@/lib/profile';
import { useTheme } from '@/lib/theme';

type Provider = 'google' | 'apple';
const PROVIDERS: { id: Provider; label: string; icon: IconName }[] = [
  { id: 'google', label: 'Google', icon: 'logo-google' },
  { id: 'apple', label: 'Apple', icon: 'logo-apple' },
];

/** s••••••4@gmail.com: enough to recognise your own address, not enough to read someone else's. */
function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain || name.length < 3) return email;
  return `${name[0]}${'•'.repeat(Math.min(name.length - 2, 8))}${name[name.length - 1]}@${domain}`;
}
function maskPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 5)}•••••${phone.slice(-2)}` : phone;
}

/** Settings → Account management: sign-in methods (email, phone, Google, Apple), password, and ownership. */
export default function AccountScreen() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { profile } = useProfile();
  const { c } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Add a phone: enter number → enter the SMS code.
  const [phoneStep, setPhoneStep] = useState<'idle' | 'number' | 'code'>('idle');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pendingPhoneId, setPendingPhoneId] = useState<string | null>(null);

  if (!user) return <Screen edges={['bottom']}><View /></Screen>;
  const hasPassword = user.passwordEnabled;
  const email = user.primaryEmailAddress?.emailAddress;
  const verifiedPhone = user.phoneNumbers.find((p) => p.verification?.status === 'verified');
  const linked = (p: Provider) => user.externalAccounts.find((a) => a.provider.replace(/^oauth_/, '') === p);

  // Link Google/Apple to this account (Clerk opens the provider, then returns here).
  const connect = async (p: Provider) => {
    setBusy(p);
    try {
      const redirectUrl = Platform.OS === 'web' ? `${window.location.origin}/account` : AuthSession.makeRedirectUri({ path: 'account' });
      const account = await user.createExternalAccount({ strategy: `oauth_${p}`, redirectUrl });
      const url = account.verification?.externalVerificationRedirectURL?.href;
      if (url && Platform.OS === 'web') return window.location.assign(url);
      if (url) await WebBrowser.openAuthSessionAsync(url, redirectUrl);
      await user.reload();
    } catch (e) {
      Alert.alert(`Could not connect ${p === 'google' ? 'Google' : 'Apple'}`, clerkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sendPhoneCode = async () => {
    setPhoneError(null);
    setBusy('phone');
    try {
      const res = await user.createPhoneNumber({ phoneNumber: phone.trim() });
      await res.prepareVerification();
      setPendingPhoneId(res.id);
      setPhoneStep('code');
    } catch (e) {
      setPhoneError(clerkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmPhone = async () => {
    setPhoneError(null);
    setBusy('phone');
    try {
      const res = user.phoneNumbers.find((p) => p.id === pendingPhoneId);
      if (!res) throw new Error('Start again: enter your number.');
      await res.attemptVerification({ code: code.trim() });
      await user.reload();
      setPhoneStep('idle');
      setPhone('');
      setCode('');
    } catch (e) {
      setPhoneError(clerkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async () => {
    setError(null);
    if (next.length < 8) return setError('Use at least 8 characters.');
    setSaving(true);
    try {
      await user.updatePassword({ newPassword: next, ...(hasPassword ? { currentPassword: current } : {}), signOutOfOtherSessions: true });
      setCurrent('');
      setNext('');
      Alert.alert(hasPassword ? 'Password changed' : 'Password set', 'Other devices have been signed out.');
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const sectionTitle = (t: string) => <Text variant="caption" muted style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{t}</Text>;
  const methodRow = (icon: IconName, label: string, right: React.ReactNode, last = false) => (
    <Row style={{ minHeight: 56, paddingHorizontal: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.divider }}>
      <Ionicons name={icon} size={20} color={c.text} />
      <Text style={{ flex: 1 }}>{label}</Text>
      {right}
    </Row>
  );
  const status = (text: string, ok = true) => (
    <Row gap={6}>
      <Text variant="caption" muted numberOfLines={1} style={{ maxWidth: 170 }}>{text}</Text>
      {ok && <Ionicons name="checkmark-circle" size={16} color={c.success} />}
    </Row>
  );

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {profile && <Text variant="caption" faint>ID {profile.user_number}{user.createdAt ? ` · member since ${new Date(user.createdAt).toLocaleDateString()}` : ''}</Text>}

        <View style={{ gap: 8 }}>
          {sectionTitle('Sign-in methods')}
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {methodRow('mail-outline', 'Email', email ? status(maskEmail(email)) : status('Not added', false))}
            {methodRow('phone-portrait-outline', 'Phone',
              verifiedPhone ? status(maskPhone(verifiedPhone.phoneNumber))
                : <Button title="Add" size="sm" variant="secondary" onPress={() => setPhoneStep(phoneStep === 'idle' ? 'number' : 'idle')} />)}
            {phoneStep !== 'idle' && (
              <View style={{ padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: c.divider, backgroundColor: c.violetSurface }}>
                {phoneStep === 'number' ? (
                  <>
                    <Input label="Phone number (with country code)" placeholder="+92 300 1234567" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} />
                    <Button title="Send code" size="sm" onPress={() => void sendPhoneCode()} loading={busy === 'phone'} disabled={phone.trim().length < 8} />
                  </>
                ) : (
                  <>
                    <Input label={`Code sent to ${phone}`} keyboardType="number-pad" autoComplete="sms-otp" value={code} onChangeText={setCode} />
                    <Button title="Confirm" size="sm" onPress={() => void confirmPhone()} loading={busy === 'phone'} disabled={code.trim().length < 4} />
                  </>
                )}
                {phoneError && <Text variant="caption" color={c.danger}>{phoneError}</Text>}
              </View>
            )}
            {PROVIDERS.map((p) => {
              const a = linked(p.id);
              return methodRow(p.icon, p.label,
                a ? status(a.emailAddress ? maskEmail(a.emailAddress) : 'Connected')
                  : <Button title="Connect" size="sm" variant="secondary" loading={busy === p.id} onPress={() => void connect(p.id)} />, false);
            })}
            {methodRow('key-outline', 'Password', status(hasPassword ? 'Set' : 'Not set', hasPassword), true)}
          </Card>
        </View>

        <Card style={{ padding: 16, gap: 10 }}>
          <Text variant="h3">{hasPassword ? 'Change password' : 'Set a password'}</Text>
          {!hasPassword && <Text variant="caption" muted>Add a password so you can also sign in with your email.</Text>}
          {hasPassword && <Input label="Current password" secureTextEntry autoComplete="current-password" value={current} onChangeText={setCurrent} />}
          <Input label="New password" secureTextEntry autoComplete="new-password" value={next} onChangeText={setNext} />
          {error && <Text variant="caption" color={c.danger}>{error}</Text>}
          <Button title={hasPassword ? 'Change password' : 'Set password'} onPress={() => void savePassword()} loading={saving} disabled={!next || (hasPassword && !current)} />
        </Card>

        <Card style={{ padding: 16, gap: 8 }}>
          <Row gap={8}><Ionicons name="shield-checkmark-outline" size={18} color={c.primary} /><Text variant="h3">Keep your account safe</Text></Row>
          <Text variant="caption" muted>• Connect more than one way to sign in (Google, Apple, phone). If you lose one, you can still get in.</Text>
          <Text variant="caption" muted>• {`${brand.name} will never ask for your password or codes by message, WhatsApp or phone.`}</Text>
          <Text variant="caption" muted>• Changing your password signs out every other device.</Text>
        </Card>

        <View style={{ gap: 8 }}>
          {sectionTitle('Account ownership')}
          <Card style={{ padding: 16, gap: 8 }}>
            <Text variant="caption" muted>
              {`This account and everything in it belong to you. Deleting it is permanent: your profile, messages, followers and frames are removed and can't be brought back. Withdraw any beans first, because unwithdrawn earnings are lost.`}
            </Text>
          </Card>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            <ListRow icon="log-out-outline" label="Sign out" onPress={() => confirmAction('Sign out', 'You can sign back in any time.', 'Sign out', () => void signOut().then(() => router.replace('/')))} />
            <ListRow icon="trash-outline" label="Delete account" color={c.danger} onPress={() => router.push('/delete-account')} last />
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
