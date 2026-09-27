'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { authFetch } from '@/lib/api-client';

type Earnings = { balance: string; held: string; lifetime: string };
type Wallet = { coinBalance: string; frozen: boolean };
type Room = { id: string; status: 'offline' | 'live'; title: string; viewerCount: number } | null;

export default function CreatorPage() {
  return (
    <RequireAuth>
      <CreatorDashboard />
    </RequireAuth>
  );
}

function CreatorDashboard() {
  const { token, user, logout } = useAuth();
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [room, setRoom] = useState<Room>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [e, w, r] = await Promise.all([
        authFetch<Earnings>('/earnings/me', token),
        authFetch<Wallet>('/wallet/me', token),
        authFetch<Room>('/streams/me', token).catch(() => null),
      ]);
      setEarnings(e);
      setWallet(w);
      setRoom(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Creator dashboard</h1>
        <button onClick={logout} className="text-sm text-white/60 hover:text-white">
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-white/60">{user?.displayName ?? user?.email}</p>

      {loading && <p className="mt-8 text-white/60">Loading…</p>}
      {error && (
        <div className="mt-8 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
          {error}
          <button onClick={() => void load()} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Coin balance" value={wallet?.coinBalance ?? '0'} sub={wallet?.frozen ? 'Frozen' : undefined} />
          <StatCard label="Earnings balance" value={earnings?.balance ?? '0'} />
          <StatCard label="Lifetime earnings" value={earnings?.lifetime ?? '0'} />
        </div>
      )}

      {!loading && !error && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-bold">Room status</h2>
          {room ? (
            <p className="mt-2 text-sm text-white/70">
              <span className={room.status === 'live' ? 'text-green-400' : 'text-white/50'}>
                {room.status === 'live' ? '● LIVE' : 'Offline'}
              </span>{' '}
              — {room.title} {room.status === 'live' && `· ${room.viewerCount} watching`}
            </p>
          ) : (
            <p className="mt-2 text-sm text-white/50">Not registered as a host yet — call POST /hosts/become from the app.</p>
          )}
        </div>
      )}

      {!loading && !error && earnings && <WithdrawalForm token={token!} balance={earnings.balance} onRequested={load} />}
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs text-white/50">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{Number(value).toLocaleString()}</p>
      {sub && <p className="mt-1 text-xs text-pink">{sub}</p>}
    </div>
  );
}

function WithdrawalForm({ token, balance, onRequested }: { token: string; balance: string; onRequested: () => void }) {
  const [coins, setCoins] = useState('');
  const [method, setMethod] = useState('easypaisa');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      await authFetch('/withdrawals', token, {
        method: 'POST',
        body: JSON.stringify({ coins: Number(coins), payoutMethod: { type: method } }),
      });
      setMessage('Withdrawal requested.');
      setCoins('');
      onRequested();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="font-bold">Request withdrawal</h2>
      <p className="mt-1 text-xs text-white/50">Available: {Number(balance).toLocaleString()} coins</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Coins
          <input
            type="number"
            min={1}
            value={coins}
            onChange={(e) => setCoins(e.target.value)}
            className="w-32 rounded-lg border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-mid"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Payout method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-mid"
          >
            <option value="easypaisa">Easypaisa</option>
            <option value="jazzcash">JazzCash</option>
            <option value="bank">Bank</option>
          </select>
        </label>
        <button
          onClick={submit}
          disabled={busy || !coins}
          className="rounded-lg bg-gradient-to-r from-deep via-mid to-pink px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          {busy ? 'Requesting…' : 'Request'}
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-white/70">{message}</p>}
    </div>
  );
}
