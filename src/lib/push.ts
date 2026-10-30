import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

type Notifications = typeof import('expo-notifications');

let mod: Notifications | null | undefined;
/** expo-notifications, or null in a build without its native module. */
function notifications(): Notifications | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-notifications') as Notifications;
    } catch {
      mod = null;
    }
  }
  return mod;
}

let currentToken: string | null = null;

/** Where a tapped notification goes; only paths inside the app. */
function openFrom(data: unknown) {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) router.push(url as never);
}

/**
 * Phone notifications for the signed-in account: registers this phone's Expo push token (asking
 * permission once), shows notifications while the app is open, and opens the right screen on tap.
 * What gets sent is decided by the server (push-send / internal_push_messages).
 */
export function usePushNotifications(supabase: SupabaseClient, signedIn: boolean) {
  useEffect(() => {
    const N = notifications();
    if (!N || !signedIn) return;
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
    });
    let alive = true;
    void (async () => {
      try {
        if (Platform.OS === 'android') {
          await N.setNotificationChannelAsync('default', { name: 'Zynalive', importance: N.AndroidImportance.HIGH });
        }
        let { status } = await N.getPermissionsAsync();
        if (status === 'undetermined') status = (await N.requestPermissionsAsync()).status;
        if (status !== 'granted' || !alive) return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        const { data: token } = await N.getExpoPushTokenAsync({ projectId });
        if (!alive) return;
        await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
        currentToken = token;
      } catch {
        // No push on this phone (no Play services, simulator, Expo Go): the app works the same.
      }
    })();
    // Tapped while the app was closed: open where it points once.
    void N.getLastNotificationResponseAsync().then((r) => {
      if (alive && r) openFrom(r.notification.request.content.data);
    }).catch(() => {});
    const sub = N.addNotificationResponseReceivedListener((r) => openFrom(r.notification.request.content.data));
    return () => {
      alive = false;
      sub.remove();
    };
  }, [supabase, signedIn]);
}

/** Stops this phone receiving the account's notifications (call before signing out). */
export async function unregisterPush(supabase: SupabaseClient) {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  await supabase.rpc('unregister_push_token', { p_token: token }).then(() => {}, () => {});
}
