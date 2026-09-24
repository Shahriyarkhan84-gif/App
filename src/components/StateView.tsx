import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { friendlyError } from '@/lib/errors';
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
  | { kind: 'permission'; title: string; body: string; onGrant: () => void }
  | { kind: 'disabled'; title: string; body?: string };

type IconName = ComponentProps<typeof Ionicons>['name'];

function Message({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <Ionicons name={icon} size={40} color={c.textMuted} />
      <Text variant="h3" style={{ textAlign: 'center' }}>{title}</Text>
      {body && <Text muted style={{ textAlign: 'center' }}>{body}</Text>}
      {children}
    </View>
  );
}

export function StateView({ state, children }: { state: ViewState; children?: ReactNode }) {
  const { c } = useTheme();
  switch (state.kind) {
    case 'success':
      return <>{children}</>;
    case 'loading':
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Loading">
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      );
    case 'error':
      return (
        <Message icon="alert-circle-outline" title="Something went wrong" body={friendlyError(state.error)}>
          {state.onRetry && <Button title="Try again" variant="secondary" onPress={state.onRetry} />}
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
        <Message icon="cloud-offline-outline" title="You're offline" body="Check your connection and try again.">
          {state.onRetry && <Button title="Retry" variant="secondary" onPress={state.onRetry} />}
        </Message>
      );
    case 'permission':
      return (
        <Message icon="lock-closed-outline" title={state.title} body={state.body}>
          <Button title="Allow access" onPress={state.onGrant} />
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
