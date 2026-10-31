import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { ScrollView, View } from 'react-native';

import { PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Card, Row, Screen, Text, VerifiedTick } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { U } from '@/lib/brand';
import { showResellers } from '@/lib/env';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type Reseller = { user_number: number; display_name: string; avatar_url: string | null; whatsapp: string; note: string | null; discount_pct: number };

/**
 * Official resellers: users pay them with JazzCash or Easypaisa and get diamonds at a discount.
 * The payment and the diamonds are between the user and the reseller; the app only lists them.
 */
export default function ResellersScreen() {
  const supabase = useSupabase();
  const offline = useOffline();
  const { c } = useTheme();
  const { profile } = useProfile();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.rpc('list_resellers');
    if (error) throw error;
    return (data ?? []) as Reseller[];
  }, []);

  const topDiscount = Math.max(0, ...(data ?? []).map((r) => r.discount_pct));

  const contact = async (r: Reseller) => {
    const text = `Hi, I want to buy Zynalive ${U.spend} with JazzCash/Easypaisa. My Zynalive ID is ${profile?.user_number ?? ''}.`;
    const url = `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(text)}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('WhatsApp not available', `Message ${r.display_name} on +${r.whatsapp}.`);
    }
  };

  if (!showResellers) {
    return (
      <Screen edges={['bottom']}>
        <StateView state={{ kind: 'disabled', title: 'Not available in this app', body: `Buy ${U.spend} in the Wallet.` }} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <StateView
        state={resolveState({
          offline, loading, error, data, onRetry: reload,
          isEmpty: (d) => d.length === 0,
          empty: { title: 'No resellers yet', body: `Buy ${U.spend} in the Wallet, or check back soon.` },
        })}
      >
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <View style={{ gap: 4 }}>
            <Text variant="h3">Pay with JazzCash or Easypaisa</Text>
            <Text muted>
              Message an official reseller on WhatsApp, pay them with JazzCash or Easypaisa, and they add the {U.spend} to your
              Zynalive ID {profile?.user_number ? profile.user_number : ''}.{topDiscount > 0 ? ` Up to ${topDiscount}% off.` : ''}
            </Text>
          </View>
          {(data ?? []).map((r) => (
            <Card key={r.user_number}>
              <Row>
                <Avatar uri={r.avatar_url} name={r.display_name} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}>
                    <Text variant="label" style={{ flexShrink: 1 }}>{r.display_name}</Text>
                    <VerifiedTick size={16} label="Official reseller" />
                  </Row>
                  <Text variant="caption" muted>ID {r.user_number}{r.note ? ` · ${r.note}` : ''}</Text>
                </View>
                <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: c.violetSurface, borderWidth: 1, borderColor: c.violetBorder }}>
                  <Text variant="caption" color={c.violetText} style={{ fontWeight: '700' }}>{r.discount_pct}% off</Text>
                </View>
              </Row>
              {/* WhatsApp green, so it reads as "opens WhatsApp". */}
              <PressScale onPress={() => contact(r)} disabled={offline} accessibilityRole="button" accessibilityLabel={`Message ${r.display_name} on WhatsApp`} scaleTo={0.98}
                style={{ borderRadius: 24, overflow: 'hidden', opacity: offline ? 0.5 : 1 }}>
                <LinearGradient colors={['#25D366', '#14B8A6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Ionicons name="logo-whatsapp" size={20} color="#04210F" />
                  <Text variant="label" color="#04210F">Message on WhatsApp</Text>
                </LinearGradient>
              </PressScale>
            </Card>
          ))}
          <Text variant="caption" faint>
            Only pay the resellers listed here, and check the reseller&apos;s ID before you pay. Zynalive never asks for your password or OTP.
          </Text>
        </ScrollView>
      </StateView>
    </Screen>
  );
}
