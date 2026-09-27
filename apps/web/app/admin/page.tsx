'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { authFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

type Report = { id: string; targetType: string; targetId: string; reason: string; status: string; createdAt: string };
type AiAction = {
  id: string;
  agent: string;
  actionType: string;
  targetUserId: string | null;
  rationale: string;
  confidence: number | null;
  status: string;
};
type Withdrawal = {
  id: string;
  coins: string;
  amountMinor: string;
  currency: string;
  status: string;
  host: { user: { displayName: string | null; username: string | null } };
};

export default function AdminPage() {
  return (
    <RequireAuth adminOnly>
      <AdminDashboard />
    </RequireAuth>
  );
}

function AdminDashboard() {
  const { user, logout } = useAuth();
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Owner command center</h1>
        <button onClick={logout} className="text-sm text-white/60 hover:text-white">
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-white/60">{user?.displayName ?? user?.email} · {user?.role}</p>

      <ReportsSection />
      <AiActionsSection />
      <WithdrawalsSection />
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ReportsSection() {
  const { token } = useAuth();
  const [reports, setReports] = useState<Report[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setReports(await authFetch<Report[]>('/reports?status=open', token));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(id: string) {
    if (!token) return;
    await authFetch(`/reports/${id}/dismiss`, token, { method: 'POST' });
    void load();
  }

  return (
    <Section title={`Open reports${reports ? ` (${reports.length})` : ''}`}>
      {!reports && <p className="text-sm text-white/50">Loading…</p>}
      {reports?.length === 0 && <p className="text-sm text-white/50">Nothing open.</p>}
      {reports?.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          <div>
            <p className="font-medium">
              {r.targetType} · {r.targetId}
            </p>
            <p className="text-white/60">{r.reason}</p>
          </div>
          <button onClick={() => dismiss(r.id)} className="rounded-md border border-white/20 px-3 py-1 text-xs hover:bg-white/10">
            Dismiss
          </button>
        </div>
      ))}
    </Section>
  );
}

function AiActionsSection() {
  const { token } = useAuth();
  const [actions, setActions] = useState<AiAction[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setActions(await authFetch<AiAction[]>('/moderation/ai-actions?status=proposed', token));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, approve: boolean) {
    if (!token) return;
    await authFetch(`/moderation/ai-actions/${id}/review`, token, { method: 'POST', body: JSON.stringify({ approve }) });
    void load();
  }

  return (
    <Section title={`AI proposals awaiting review${actions ? ` (${actions.length})` : ''}`}>
      {!actions && <p className="text-sm text-white/50">Loading…</p>}
      {actions?.length === 0 && <p className="text-sm text-white/50">Nothing pending.</p>}
      {actions?.map((a) => (
        <div key={a.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          <p className="font-medium">
            {a.agent} → {a.actionType} {a.targetUserId ? `on ${a.targetUserId}` : ''}
            {a.confidence !== null && <span className="ml-2 text-xs text-white/40">{Math.round(a.confidence * 100)}% confidence</span>}
          </p>
          <p className="mt-1 text-white/60">{a.rationale}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => review(a.id, true)} className="rounded-md bg-green-500/20 px-3 py-1 text-xs text-green-300 hover:bg-green-500/30">
              Approve
            </button>
            <button onClick={() => review(a.id, false)} className="rounded-md bg-red-500/20 px-3 py-1 text-xs text-red-300 hover:bg-red-500/30">
              Reject
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}

function WithdrawalsSection() {
  const { token } = useAuth();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setWithdrawals(await authFetch<Withdrawal[]>('/withdrawals?status=requested', token));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, approve: boolean) {
    if (!token) return;
    await authFetch(`/withdrawals/${id}/review`, token, { method: 'POST', body: JSON.stringify({ approve }) });
    void load();
  }

  return (
    <Section title={`Withdrawal requests${withdrawals ? ` (${withdrawals.length})` : ''}`}>
      {!withdrawals && <p className="text-sm text-white/50">Loading…</p>}
      {withdrawals?.length === 0 && <p className="text-sm text-white/50">Nothing pending.</p>}
      {withdrawals?.map((w) => (
        <div key={w.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          <div>
            <p className="font-medium">{w.host.user.displayName ?? w.host.user.username}</p>
            <p className="text-white/60">
              {Number(w.coins).toLocaleString()} coins · {(Number(w.amountMinor) / 100).toLocaleString()} {w.currency.toUpperCase()}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => review(w.id, true)} className="rounded-md bg-green-500/20 px-3 py-1 text-xs text-green-300 hover:bg-green-500/30">
              Approve
            </button>
            <button onClick={() => review(w.id, false)} className="rounded-md bg-red-500/20 px-3 py-1 text-xs text-red-300 hover:bg-red-500/30">
              Reject
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}
