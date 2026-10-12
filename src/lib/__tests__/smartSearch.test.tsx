import { liveRoomsByIds, similarLives } from '../smartSearch';
import { smartSearch } from '../api';

jest.mock('../api', () => ({ smartSearch: jest.fn() }));

type Row = { id: string; host_id: string; title: string; category: string; status: string; viewer_count: number };
const room = (id: string, category = 'chat'): Row => ({ id, host_id: `h_${id}`, title: `Room ${id}`, category, status: 'live', viewer_count: 1 });

/** Minimal stand-in for supabase.from(...).select(...).in/eq/neq/order/limit, resolving to the given rows. */
function fakeSupabase(rows: Row[], calls: string[] = []) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'eq', 'neq', 'order', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push(`${m}:${JSON.stringify(args[0])}`);
      return builder;
    };
  }
  builder.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return { from: () => builder } as never;
}

describe('smart search helpers', () => {
  beforeEach(() => jest.mocked(smartSearch).mockReset());

  it('keeps the ranked order and drops rooms that are no longer live', async () => {
    const rooms = await liveRoomsByIds(fakeSupabase([room('b'), room('a')]), ['a', 'gone', 'b']);
    expect(rooms.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('similar lives use smart search results, without the room itself', async () => {
    jest.mocked(smartSearch).mockResolvedValue({ results: [{ id: 'self', score: 1 }, { id: 'x', score: 0.9 }] });
    const rooms = await similarLives(fakeSupabase([room('x')]), { roomId: 'self', title: 'Cricket talk', category: 'chat' });
    expect(rooms.map((r) => r.id)).toEqual(['x']);
    expect(smartSearch).toHaveBeenCalledWith(expect.anything(), { q: 'Cricket talk chat', limit: 9 });
  });

  it('falls back to the same category when smart search is not set up', async () => {
    jest.mocked(smartSearch).mockRejectedValue(new Error('not_configured'));
    const calls: string[] = [];
    const rooms = await similarLives(fakeSupabase([room('m1', 'music')], calls), { roomId: 'self', title: 'Naat', category: 'music' });
    expect(rooms.map((r) => r.id)).toEqual(['m1']);
    expect(calls).toEqual(expect.arrayContaining(['eq:"category"', 'neq:"id"']));
  });
});
