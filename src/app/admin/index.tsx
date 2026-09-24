import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Chip, Input, Row, Screen, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { formatMoney } from '@/lib/types';

type Domain = { status: 'green' | 'amber' | 'red'; headline: string; highlights: string[]; risks: string[]; recommendations: string[] };
type Briefing = {
  id: number;
  headline: string;
  summary: string;
  created_at: string;
  data: {
    briefing: { priorities: string[]; owner_decisions: string[] };
    domains: Record<string, Domain>;
    kpis: { users?: { dau: number; mau: number; new_24h: number; d7_retention_pct: number | null }; streaming?: { live_now: number; viewers_now: number } };
  };
};

const SECTIONS = ['Briefing', 'Host applications', 'Agencies', 'AI proposals', 'Reports', 'Withdrawals', 'Settings'] as const;
const DOMAIN_TITLES: Record<string, string> = { finance_ai: '💰 Finance AI', economy_ai: '🎁 Economy AI', streaming_ai: '📡 Streaming AI' };

/** Owner command center: AI CEO output + the human-approval queue. */
export default function AdminScreen() {
  const { isPlatformAdmin, profile } = useProfile();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Briefing');
  if (profile && !isPlatformAdmin) return <Redirect href="/" />;
  return (
    <Screen edges={[]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 8 }} style={{ flexGrow: 0 }}>
        {SECTIONS.map((s) => <Chip key={s} label={s} selected={section === s} onPress={() => setSection(s)} />)}
      </ScrollView>
      {section === 'Briefing' && <BriefingSection />}
      {section === 'Host applications' && <HostApplicationsSection />}
      {section === 'Agencies' && <AgenciesSection />}
      {section === 'AI proposals' && <ProposalsSection />}
      {section === 'Reports' && <ReportsSection />}
      {section === 'Withdrawals' && <WithdrawalsSection />}
      {section === 'Settings' && <SettingsSection />}
    </Screen>
  );
}

function useAct() {
  const supabase = useSupabase();
  return async (fn: string, args: Record<string, unknown>, after: () => void) => {
    try {
      await rpc(supabase, fn, args);
      after();
    } catch (e) {
      Alert.alert('Action failed', friendlyError(e));
    }
  };
}

const listStyle = { paddingHorizontal: 16, paddingBottom: 32, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' } as const;

function BriefingSection() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const act = useAct();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('ai_reports').select('*').eq('kind', 'ceo_briefing').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as Briefing | null;
  }, []);
  const statusColor = { green: c.success, amber: c.warning, red: c.danger };

  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
      <ScrollView contentContainerStyle={listStyle}>
        <Button title="Run AI CEO briefing now" variant="secondary" onPress={() => act('request_ceo_briefing', {}, () => Alert.alert('Queued', 'The AI CEO will publish a new briefing shortly.'))} />
        {!data ? (
          <Text muted>No briefing yet — the AI CEO publishes one every hour once the agents worker is running.</Text>
        ) : (
          <>
            <Card>
              <Text variant="caption" muted>🧠 AI CEO · {new Date(data.created_at).toLocaleString()}</Text>
              <Text variant="h2">{data.headline}</Text>
              <Text>{data.summary}</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {data.data.kpis.users && <Text variant="label" muted>DAU {data.data.kpis.users.dau} · MAU {data.data.kpis.users.mau} · new {data.data.kpis.users.new_24h} · D7 {data.data.kpis.users.d7_retention_pct ?? '–'}%</Text>}
                {data.data.kpis.streaming && <Text variant="label" muted>Live now {data.data.kpis.streaming.live_now} · {data.data.kpis.streaming.viewers_now} watching</Text>}
              </Row>
            </Card>
            <Card>
              <Text variant="h3">Priorities</Text>
              {data.data.briefing.priorities.map((p, i) => <Text key={i}>{i + 1}. {p}</Text>)}
            </Card>
            {data.data.briefing.owner_decisions.length > 0 && (
              <Card style={{ borderColor: c.warning }}>
                <Text variant="h3">Needs your decision</Text>
                {data.data.briefing.owner_decisions.map((d, i) => <Text key={i}>• {d}</Text>)}
              </Card>
            )}
            {Object.entries(data.data.domains).map(([key, d]) => (
              <Card key={key}>
                <Row>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor[d.status] }} />
                  <Text variant="label">{DOMAIN_TITLES[key] ?? key}</Text>
                </Row>
                <Text variant="h3">{d.headline}</Text>
                {d.highlights.map((h, i) => <Text key={`h${i}`} muted>• {h}</Text>)}
                {d.risks.map((r, i) => <Text key={`r${i}`} color={c.danger}>⚠ {r}</Text>)}
                {d.recommendations.map((r, i) => <Text key={`c${i}`} color={c.primary}>→ {r}</Text>)}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </StateView>
  );
}

type Proposal = { id: number; agent: string; action_type: string; target_user_id: string | null; rationale: string; confidence: number | null; params: Record<string, unknown>; created_at: string };

function ProposalsSection() {
  const supabase = useSupabase();
  const offline = useOffline();
  const act = useAct();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('ai_actions').select('*').eq('status', 'proposed').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data as Proposal[];
  }, []);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No pending AI proposals' } })}>
      <ScrollView contentContainerStyle={listStyle}>
        {(data ?? []).map((p) => (
          <Card key={p.id}>
            <Text variant="caption" muted>{p.agent} AI · {new Date(p.created_at).toLocaleString()}{p.confidence != null ? ` · ${Math.round(p.confidence * 100)}% confident` : ''}</Text>
            <Text variant="h3">{p.action_type.replace(/_/g, ' ')}{p.params.hours ? ` (${String(p.params.hours)}h)` : ''}</Text>
            <Text variant="caption" muted>User {p.target_user_id}</Text>
            <Text>{p.rationale}</Text>
            <Row>
              <Button title="Approve" size="sm" onPress={() => act('review_ai_action', { p_action_id: p.id, p_approve: true }, reload)} />
              <Button title="Reject" size="sm" variant="secondary" onPress={() => act('review_ai_action', { p_action_id: p.id, p_approve: false }, reload)} />
            </Row>
          </Card>
        ))}
      </ScrollView>
    </StateView>
  );
}

type Report = { id: string; target_type: string; target_user_id: string | null; reason: string; status: string; created_at: string; ai_assessment: { summary: string; recommended_action: string; severity: number; confidence: number } | null };

function ReportsSection() {
  const supabase = useSupabase();
  const offline = useOffline();
  const act = useAct();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('reports').select('*').in('status', ['open', 'reviewing']).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data as Report[];
  }, []);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No open reports' } })}>
      <ScrollView contentContainerStyle={listStyle}>
        {(data ?? []).map((r) => (
          <Card key={r.id}>
            <Text variant="caption" muted>{r.target_type} · user {r.target_user_id} · {new Date(r.created_at).toLocaleString()}</Text>
            <Text>{r.reason}</Text>
            {r.ai_assessment ? (
              <Text muted>🤖 {r.ai_assessment.summary} (suggests {r.ai_assessment.recommended_action.replace(/_/g, ' ')}, severity {r.ai_assessment.severity})</Text>
            ) : (
              <Text variant="caption" muted>AI review pending…</Text>
            )}
            <Row style={{ flexWrap: 'wrap' }}>
              <Button title="Warn" size="sm" onPress={() => act('apply_moderation_action', { p_user: r.target_user_id, p_action: 'warning', p_reason: r.ai_assessment?.summary ?? r.reason, p_report: r.id }, reload)} />
              <Button title="Restrict 24h" size="sm" variant="secondary" onPress={() => act('apply_moderation_action', { p_user: r.target_user_id, p_action: 'temp_restriction', p_reason: r.ai_assessment?.summary ?? r.reason, p_hours: 24, p_report: r.id }, reload)} />
              <Button title="Ban 7d" size="sm" variant="danger" onPress={() => act('apply_moderation_action', { p_user: r.target_user_id, p_action: 'temp_ban', p_reason: r.ai_assessment?.summary ?? r.reason, p_hours: 168, p_report: r.id }, reload)} />
              <Button title="Dismiss" size="sm" variant="ghost" onPress={() => act('dismiss_report', { p_report: r.id }, reload)} />
            </Row>
          </Card>
        ))}
      </ScrollView>
    </StateView>
  );
}

type HostApplication = {
  id: string; user_id: string; full_name: string; phone: string; cnic_last4: string; agency_code: string;
  id_status: string | null; face_status: string | null; face_score: number | null; cnic_match: boolean | null; name_match: boolean | null;
  age: number | null; reasons: string[]; didit_id_request: string | null; created_at: string;
};

const REASON_LABELS: Record<string, string> = {
  cnic_mismatch: 'CNIC number differs from card', name_mismatch: 'Name differs from card', id_needs_review: 'Didit: ID needs review',
  face_needs_review: 'Didit: face needs review', age_unknown: 'Age not read from card',
};

/** Applications Didit couldn't auto-approve. Photos are in the Didit console (Manual Checks), never here. */
function HostApplicationsSection() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const act = useAct();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('host_applications').select('*').eq('status', 'in_review').order('created_at').limit(100);
    if (error) throw error;
    return data as HostApplication[];
  }, []);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No applications to review', body: 'Clear cases are approved or declined automatically.' } })}>
      <ScrollView contentContainerStyle={listStyle}>
        {(data ?? []).map((a) => (
          <Card key={a.id}>
            <Text variant="h3">{a.full_name}</Text>
            <Text muted>+{a.phone.replace('+', '')} · CNIC •••{a.cnic_last4} · Agency {a.agency_code}{a.age != null ? ` · ${a.age} yrs` : ''}</Text>
            <Text variant="caption" muted>
              ID {a.id_status ?? '–'} · Face {a.face_status ?? '–'}{a.face_score != null ? ` (${a.face_score})` : ''} · {new Date(a.created_at).toLocaleString()}
            </Text>
            {a.reasons.map((r) => <Text key={r} variant="bodySmall" color={c.warning}>⚠ {REASON_LABELS[r] ?? r}</Text>)}
            {a.didit_id_request && <Text variant="caption" faint selectable>Didit request {a.didit_id_request}</Text>}
            <Row>
              <Button title="Approve" size="sm" onPress={() => act('review_host_application', { p_id: a.id, p_approve: true }, reload)} />
              <Button title="Decline" size="sm" variant="secondary" onPress={() => act('review_host_application', { p_id: a.id, p_approve: false, p_note: 'Declined by owner' }, reload)} />
            </Row>
          </Card>
        ))}
      </ScrollView>
    </StateView>
  );
}

type AgencyRow = { id: string; name: string; code: string; status: string; manager_id: string | null; created_at: string };

/** Owner creates agencies (manager by 8-digit user ID); each gets a random 4-digit code. */
function AgenciesSection() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const act = useAct();
  const [name, setName] = useState('');
  const [manager, setManager] = useState('');
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('agencies').select('id,name,code,status,manager_id,created_at').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data as AgencyRow[];
  }, []);
  const canCreate = name.trim().length >= 2 && /^[1-9]\d{7}$/.test(manager);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
      <ScrollView contentContainerStyle={listStyle}>
        <Card>
          <Text variant="h3">New agency</Text>
          <Input value={name} onChangeText={setName} placeholder="Agency name" maxLength={80} />
          <Input value={manager} onChangeText={(v) => setManager(v.replace(/\D/g, '').slice(0, 8))} placeholder="Manager's 8-digit user ID" keyboardType="number-pad" />
          <Button title="Create agency" disabled={!canCreate || offline}
            onPress={() => act('create_agency_by_user_number', { p_name: name.trim(), p_user_number: Number(manager) }, () => { setName(''); setManager(''); void reload(); })} />
          <Text variant="caption" muted>The manager becomes the agency admin and sees the 4-digit code in their Agency portal.</Text>
        </Card>
        {(data ?? []).length === 0 && <Text muted style={{ textAlign: 'center' }}>No agencies yet.</Text>}
        {(data ?? []).map((a) => (
          <Card key={a.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="h3" style={{ flexShrink: 1 }}>{a.name}</Text>
              <Text variant="h3" color={c.gold} selectable style={{ letterSpacing: 4 }}>{a.code}</Text>
            </Row>
            <Text variant="caption" muted>{a.status} · since {new Date(a.created_at).toLocaleDateString()}</Text>
            <Button title="New code" size="sm" variant="secondary" onPress={() => act('regenerate_agency_code', { p_agency: a.id }, reload)} />
          </Card>
        ))}
      </ScrollView>
    </StateView>
  );
}

type Withdrawal = { id: string; host_id: string; coins: number; amount_minor: number; currency: string; payout_method: { type: string; account?: string }; status: string; created_at: string };

function WithdrawalsSection() {
  const supabase = useSupabase();
  const offline = useOffline();
  const act = useAct();
  const [refs, setRefs] = useState<Record<string, string>>({});
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('withdrawals').select('*').in('status', ['requested', 'approved']).order('created_at').limit(100);
    if (error) throw error;
    return data as Withdrawal[];
  }, []);
  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No withdrawals to review' } })}>
      <ScrollView contentContainerStyle={listStyle}>
        {(data ?? []).map((w) => (
          <Card key={w.id}>
            <Text variant="h3">{formatMoney(w.amount_minor, w.currency)} · {w.coins.toLocaleString()} coins</Text>
            <Text muted>Host {w.host_id} · {w.payout_method.type} {w.payout_method.account ?? ''} · {w.status}</Text>
            {w.status === 'requested' ? (
              <Row>
                <Button title="Approve" size="sm" onPress={() => act('review_withdrawal', { p_withdrawal_id: w.id, p_approve: true }, reload)} />
                <Button title="Reject" size="sm" variant="secondary" onPress={() => act('review_withdrawal', { p_withdrawal_id: w.id, p_approve: false, p_note: 'Rejected by owner' }, reload)} />
              </Row>
            ) : (
              <Row>
                <View style={{ flex: 1 }}>
                  <Input placeholder="Payout reference" value={refs[w.id] ?? ''} onChangeText={(t) => setRefs((r) => ({ ...r, [w.id]: t }))} />
                </View>
                <Button title="Mark paid" size="sm" disabled={!refs[w.id]} onPress={() => act('mark_withdrawal_paid', { p_withdrawal_id: w.id, p_payout_ref: refs[w.id] }, reload)} />
              </Row>
            )}
          </Card>
        ))}
      </ScrollView>
    </StateView>
  );
}

function SettingsSection() {
  const supabase = useSupabase();
  const offline = useOffline();
  const act = useAct();
  const [rate, setRate] = useState('');
  const [minCoins, setMinCoins] = useState('');
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('platform_settings').select('key,value');
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, Record<string, number | null>>;
  }, []);
  const w = data?.withdrawal;

  return (
    <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
      <ScrollView contentContainerStyle={listStyle}>
        <Card>
          <Text variant="h3">Withdrawal rate (coin → PKR)</Text>
          <Text muted>
            Bridges the gift economy (90/5/5 in coins) and the PKR revenue split. Withdrawals stay disabled until this is set.
            Current: {w?.pkr_per_coin ?? 'not set'} · min {w?.min_coins ?? '–'} coins
          </Text>
          <Input label="PKR per coin" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder={String(w?.pkr_per_coin ?? '0.5')} />
          <Input label="Minimum coins" value={minCoins} onChangeText={(t) => setMinCoins(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder={String(w?.min_coins ?? 1000)} />
          <Button
            title="Save"
            disabled={!rate && !minCoins}
            onPress={() =>
              act('set_platform_setting', {
                p_key: 'withdrawal',
                p_value: { pkr_per_coin: rate ? Number(rate) : w?.pkr_per_coin ?? null, min_coins: minCoins ? Number(minCoins) : w?.min_coins ?? 1000 },
              }, () => { setRate(''); setMinCoins(''); reload(); })
            }
          />
        </Card>
        <Card>
          <Text variant="h3">Splits</Text>
          <Text muted>Gift split: {JSON.stringify(data?.gift_split)}</Text>
          <Text muted>Purchase split (bps): {JSON.stringify(data?.purchase_split)}</Text>
        </Card>
      </ScrollView>
    </StateView>
  );
}
