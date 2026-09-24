import { requireEnv } from './cors.ts';

/**
 * Pinecone index with integrated embedding (e.g. llama-text-embed-v2) and
 * field_map { text: "text" }. Pinecone embeds the text for us on upsert/search.
 */
const API_VERSION = '2025-04';
export const NAMESPACE = 'videos';

function host() {
  return requireEnv('PINECONE_INDEX_HOST').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

async function call(path: string, init: RequestInit) {
  const res = await fetch(`https://${host()}${path}`, {
    ...init,
    headers: {
      'Api-Key': requireEnv('PINECONE_API_KEY'),
      'X-Pinecone-API-Version': API_VERSION,
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`Pinecone ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

export type PineconeRecord = { _id: string; text: string } & Record<string, string | number | boolean | string[]>;

export async function upsertRecords(records: PineconeRecord[]) {
  // Upsert takes newline-delimited JSON, max 96 records per request.
  for (let i = 0; i < records.length; i += 96) {
    const body = records.slice(i, i + 96).map((r) => JSON.stringify(r)).join('\n');
    await call(`/records/namespaces/${NAMESPACE}/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    });
  }
}

/** Semantic search; returns matching video ids, best first. */
export async function searchText(text: string, topK = 20, excludeIds: string[] = []) {
  const res = await call(`/records/namespaces/${NAMESPACE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        inputs: { text },
        top_k: topK + excludeIds.length,
      },
      fields: ['title'],
    }),
  });
  const data = (await res.json()) as { result: { hits: { _id: string; _score: number }[] } };
  return data.result.hits.map((h) => h._id).filter((id) => !excludeIds.includes(id)).slice(0, topK);
}

export function videoToText(v: { title: string; description: string; genres: string[]; release_year: number | null }) {
  return `${v.title}. ${v.genres.join(', ')}. ${v.description}${v.release_year ? ` (${v.release_year})` : ''}`;
}
