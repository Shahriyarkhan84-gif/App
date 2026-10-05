import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

import { friendlyError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

import { Button, Text } from './ui';

/**
 * The seven screen states (architecture §09): loading · success · error ·
 * empty · offline · permission · disabled. "success" renders children.
 */
export type ViewState =
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; error: unknown; onRetry?: () => void }
  | { kind: 'empty'; title: string; body?: string; action?: { title: string; onPress: () => void } }
  | { kind: 'offline'; onRetry?: () => void }
  | { kind: 'permission'; title: string; body: string; onGrant: () => void; grantTitle?: string }
  | { kind: 'disabled'; title: string; body?: string };

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Error/empty/offline/permission/disabled message. It scrolls (long text, small phones, large
 * fonts never get cut off) and, when the state can be retried, pull-to-refresh retries it.
 */
function Message({ icon, title, body, children, onRefresh }: { icon: IconName; title: string; body?: string; children?: ReactNode; onRefresh?: () => void }) {
  const { c } = useTheme();
  return (
    <ScrollView
      testID="state-view-scroll"
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={c.textMuted} /> : undefined}
    >
      <Ionicons name={icon} size={40} color={c.textMuted} />
      <Text variant="h3" style={{ textAlign: 'center' }}>{title}</Text>
      {body && <Text muted style={{ textAlign: 'center' }}>{body}</Text>}
      {children}
    </ScrollView>
  );
}

export function StateView({ state, children }: { state: ViewState; children?: ReactNode }) {
  const { c } = useTheme();
  const { t } = useI18n();
  switch (state.kind) {
    case 'success':
      return <>{children}</>;
    case 'loading':
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={t('state.loading')}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      );
    case 'error':
      return (
        <Message icon="alert-circle-outline" title={t('state.error.title')} body={friendlyError(state.error)} onRefresh={state.onRetry}>
          {state.onRetry && <Button title={t('state.retry')} variant="secondary" onPress={state.onRetry} />}
        </Message>
      );
    case 'empty':
      return (
        <Message icon="sparkles-outline" title={state.title} body={state.body}>
          {state.action && <Button title={state.action.title} onPress={state.action.onPress} />}
        </Message>
      );
    case 'offline':
      return (
        <Message icon="cloud-offline-outline" title={t('state.offline.title')} body={t('state.offline.body')} onRefresh={state.onRetry}>
          {state.onRetry && <Button title={t('state.offline.retry')} variant="secondary" onPress={state.onRetry} />}
        </Message>
      );
    case 'permission':
      return (
        <Message icon="lock-closed-outline" title={state.title} body={state.body}>
          <Button title={state.grantTitle ?? t('state.permission.allow')} onPress={state.onGrant} />
        </Message>
      );
    case 'disabled':
      return <Message icon="pause-circle-outline" title={state.title} body={state.body} />;
  }
}

/** Picks the right state for a data-backed screen. */
export function resolveState<T>(opts: {
  offline: boolean;
  loading: boolean;
  error: Error | null;
  data: T | undefined;
  isEmpty?: (data: T) => boolean;
  empty?: Omit<Extract<ViewState, { kind: 'empty' }>, 'kind'>;
  onRetry: () => void;
}): ViewState {
  if (opts.data === undefined) {
    if (opts.offline) return { kind: 'offline', onRetry: opts.onRetry };
    if (opts.error) return { kind: 'error', error: opts.error, onRetry: opts.onRetry };
    return { kind: 'loading' };
  }
  if (opts.isEmpty?.(opts.data) && opts.empty) return { kind: 'empty', ...opts.empty };
  return { kind: 'success' };
}
