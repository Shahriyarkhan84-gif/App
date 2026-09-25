import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { FadeIn, Pop, PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { AgencyOwnerBadge, Avatar, Button, Card, Chip, Coin, compactNumber, HostBadge, Row, Screen, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { errorCode } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type PortalHost = {
  user_id: string; display_name: string | null; username: string | null; avatar_url: string | null; user_number: number | null;
  verification_status: string; status: string; live: boolean | null; earnings_lifetime: number | null;
};
type PortalApplication = { id: string; full_name: string; user_number: number | null; status: 'approved' | 'in_review' | 'declined'; created_at: string; phone: string | null };
type Portal = {
  agency: { id: string; name: string; code: string; status: string };
  role: 'admin' | 'manager' | 'agent';
  stats: { hosts: number; verified: number; live_now: number; in_review: number; earnings_lifetime: number | null };
  hosts: PortalHost[];
  applications: PortalApplication[];
};

const TABS = ['Hosts', 'Applications'] as const;

/** Agency portal: the agency's 4-digit code (hosts type it when verifying), its hosts and their applications. */
export default function AgencyPortalScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Hosts');
  const { data, error, loading, reload } = useFocusedAsync(() => rpc<Portal>(supabase, 'agency_portal', {}), []);

  if (error && errorCode(error) === 'not_agency_member') {
    return <Screen edges={[]}><StateView state={{ kind: 'disabled', title: 'No agency yet', body: 'The agency portal is for agency owners and staff. Ask Zynalive to set up your agency.' }} /></Screen>;
  }

  const shareCode = (p: Portal) =>
    Share.share({ message: `Join ${p.agency.name} on Zynalive! When you verify for hosting, enter agency code ${p.agency.code}.` });

  return (
    <Screen edges={['bottom']}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
            <FadeIn style={{ gap: 4 }}>
              <Text variant="h1">{data.agency.name}</Text>
              <Row gap={8}>
                {data.role === 'admin' ? <AgencyOwnerBadge /> : <Text muted>{data.role === 'manager' ? 'Manager' : 'Agent'}</Text>}
                {data.agency.status !== 'active' && <Text muted>Suspended</Text>}
              </Row>
            </FadeIn>

            <FadeIn delay={60}>
              <Card style={{ gap: 12, backgroundColor: c.goldSurface, borderColor: c.goldBorder }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="label" color={c.goldText}>Agency code</Text>
                  <Row gap={4}><Ionicons name="lock-closed" size={12} color={c.goldText} /><Text variant="caption" color={c.goldText}>Permanent</Text></Row>
                </Row>
                <View accessible accessibilityLabel={`Agency code ${data.agency.code.split('').join(' ')}`} style={{ flexDirection: 'row', gap: 8 }}>
                  {data.agency.code.split('').map((d, i) => (
                    <Pop key={`${i}-${d}`} delay={200 + i * 90} from={0.5}>
                      <View style={{ width: 58, height: 68, borderRadius: 14, backgroundColor: '#1A1408', borderWidth: 1, borderColor: c.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
                        <Text variant="display" selectable style={{ fontSize: 36, lineHeight: 44, color: c.gold }}>{d}</Text>
                      </View>
                    </Pop>
                  ))}
                </View>
                <Text variant="bodySmall" color={c.goldText}>New hosts enter this code in “Verify with Didit”. Once they pass, they join your agency automatically. This code is yours for good — it never changes.</Text>
                <Row gap={8}>
                  <Button title="Share code" icon={<Ionicons name="share-social-outline" size={16} color={c.onGold} />} variant="gold" size="sm" onPress={() => void shareCode(data)} />
                </Row>
              </Card>
            </FadeIn>

            <FadeIn delay={120} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <Stat label="Hosts" value={data.stats.hosts} />
              <Stat label="Verified" value={data.stats.verified} />
              <Stat label="Live now" value={data.stats.live_now} color={c.primary} />
              <Stat label="In review" value={data.stats.in_review} />
              {data.stats.earnings_lifetime != null && <Stat label="Host earnings" value={data.stats.earnings_lifetime} coin />}
            </FadeIn>

            <Row gap={8}>
              {TABS.map((t) => <Chip key={t} label={t} selected={tab === t} onPress={() => setTab(t)} />)}
            </Row>

            {tab === 'Hosts' && (data.hosts.length === 0 ? (
              <Empty icon="people-outline" title="No hosts yet" body="Share your agency code with new hosts to get started." />
            ) : (
              <Card style={{ gap: 0, paddingVertical: 4 }}>
                {data.hosts.map((h, i) => (
                  <PressScale key={h.user_id} scaleTo={0.98} onPress={() => router.push({ pathname: '/user/[id]', params: { id: h.user_id } })} accessibilityRole="button"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i === data.hosts.length - 1 ? 0 : 1, borderBottomColor: c.divider }}>
                    <Avatar uri={h.avatar_url} name={h.display_name ?? h.username} size={44} ring={h.live ? c.primary : undefined} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Row gap={6}>
                        <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{h.display_name ?? h.username ?? 'Host'}</Text>
                        {h.verification_status === 'approved' && <HostBadge small />}
                      </Row>
                      <Text variant="caption" muted>ID {h.user_number ?? '—'}{h.live ? ' · Live now' : ''}{h.status !== 'active' ? ' · Suspended' : ''}</Text>
                    </View>
                    {h.earnings_lifetime != null && (
                      <Row gap={4}><Coin size={14} /><Text variant="label">{compactNumber(h.earnings_lifetime)}</Text></Row>
                    )}
                  </PressScale>
                ))}
              </Card>
            ))}

            {tab === 'Applications' && (data.applications.length === 0 ? (
              <Empty icon="document-text-outline" title="No applications yet" body="Applications that use your code appear here." />
            ) : (
              <Card style={{ gap: 0, paddingVertical: 4 }}>
                {data.applications.map((a, i) => (
                  <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i === data.applications.length - 1 ? 0 : 1, borderBottomColor: c.divider }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="label" numberOfLines={1}>{a.full_name}</Text>
                      <Text variant="caption" muted>
                        ID {a.user_number ?? '—'}{a.phone ? ` · ${a.phone}` : ''} · {new Date(a.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <StatusPill status={a.status} />
                  </View>
                ))}
              </Card>
            ))}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}

function Stat({ label, value, color, coin }: { label: string; value: number; color?: string; coin?: boolean }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: '45%', gap: 4 }}>
      <Row gap={6}>
        {coin && <Coin size={18} />}
        <Text variant="h2" color={color}>{compactNumber(value)}</Text>
      </Row>
      <Text variant="caption" muted>{label}</Text>
    </Card>
  );
}

function StatusPill({ status }: { status: PortalApplication['status'] }) {
  const { c } = useTheme();
  const map = {
    approved: { label: 'Approved', color: c.success },
    in_review: { label: 'In review', color: c.warning },
    declined: { label: 'Declined', color: c.danger },
  } as const;
  const s = map[status];
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: s.color }}>
      <Text variant="caption" color={s.color}>{s.label}</Text>
    </View>
  );
}

function Empty({ icon, title, body }: { icon: 'people-outline' | 'document-text-outline'; title: string; body: string }) {
  const { c } = useTheme();
  return (
    <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 28 }}>
      <Ionicons name={icon} size={32} color={c.textMuted} />
      <Text variant="h3">{title}</Text>
      <Text muted style={{ textAlign: 'center' }}>{body}</Text>
    </Card>
  );
}
