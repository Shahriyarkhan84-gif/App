import { fetchLiveRooms } from '@/lib/api';

export default async function HomePage() {
  const rooms = await fetchLiveRooms();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-extrabold">
        zyna<span className="bg-gradient-to-r from-mid to-pink bg-clip-text text-transparent">live</span>
      </h1>
      <p className="mt-2 text-sm text-white/60">Real people, real moments, live together.</p>

      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {rooms.length === 0 && <p className="col-span-full text-white/50">No one is live right now.</p>}
        {rooms.map((room) => (
          <a
            key={room.id}
            href={`/live/${room.id}`}
            className="group relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br from-[#7a4fbf] to-[#c2578f]"
          >
            <div className="absolute left-2 top-2 rounded-md bg-gradient-to-r from-deep via-mid to-pink px-2 py-0.5 text-[10px] font-bold">
              LIVE
            </div>
            <div className="absolute right-2 top-2 rounded-md bg-black/50 px-2 py-0.5 text-[10px]">
              {room.viewerCount}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-sm font-bold">
              {room.host.user.displayName ?? room.host.user.username ?? 'Host'}
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}
