import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PosterCard } from '@/components/PosterCard';
import { EmptyState, Loading } from '@/components/States';
import { useAnalytics } from '@/lib/analytics';
import { searchVideos } from '@/lib/api';
import { useSupabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import type { Video } from '@/lib/types';

const SUGGESTIONS = ['a heartwarming animated adventure', 'robots and the future', 'something short and funny', 'fantasy with dragons'];

export default function SearchScreen() {
  const supabase = useSupabase();
  const track = useAnalytics();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<{ query: string; videos: Video[] } | null>(null);
  const [source, setSource] = useState<'semantic' | 'keyword'>('semantic');
  const [loading, setLoading] = useState(false);

  const columns = Math.max(3, Math.floor(width / 140));
  const cardWidth = (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  // Debounced search. Semantic search (Pinecone) understands natural-language
  // queries like "a cozy mystery"; falls back to keyword matching.
  const trimmed = query.trim();
  const active = trimmed.length >= 2;
  const results = active && response ? response.videos : null;

  useEffect(() => {
    const q = trimmed;
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchVideos(supabase, q);
        if (cancelled) return;
        setResponse({ query: q, videos: res.videos });
        setSource(res.source);
        track('search_performed', { query: q, results: res.videos.length, source: res.source });
      } catch {
        if (!cancelled) setResponse({ query: q, videos: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, supabase, track]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Describe what you want to watch…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {results && <Text style={styles.hint}>{source === 'semantic' ? '✨ AI-powered results' : 'Keyword results'}</Text>}
      </View>

      {active && (loading || !response) && !results ? (
        <Loading />
      ) : !active || results === null ? (
        <View style={styles.suggestions}>
          <Text style={styles.suggestionsTitle}>Try searching for</Text>
          {SUGGESTIONS.map((s) => (
            <Text key={s} style={styles.suggestion} onPress={() => setQuery(s)}>
              “{s}”
            </Text>
          ))}
        </View>
      ) : results.length === 0 ? (
        <EmptyState title="No matches" body="Try describing the mood, genre or story instead." />
      ) : (
        <FlatList
          key={columns}
          data={results}
          numColumns={columns}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
          columnWrapperStyle={{ gap: spacing.md }}
          renderItem={({ item }) => <PosterCard video={item} width={cardWidth} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, gap: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    height: 48,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hint: { color: colors.textMuted, fontSize: 12 },
  suggestions: { padding: spacing.lg, gap: spacing.md },
  suggestionsTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  suggestion: { color: colors.textMuted, fontSize: 15 },
});
