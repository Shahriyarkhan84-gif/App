import type { AlertButton } from 'react-native';

/**
 * Web stand-in for React Native's Alert, which does nothing in browsers (so confirmations such as
 * "End your stream?" never appeared and the action could not be taken). Uses the browser's own
 * dialogs: one action → confirm(); several → one confirm() per action until one is chosen.
 */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    const text = [title, message].filter(Boolean).join('\n\n');
    const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
    const cancel = (buttons ?? []).find((b) => b.style === 'cancel');
    if (actions.length === 0) {
      window.alert(text);
      buttons?.[0]?.onPress?.();
      return;
    }
    if (actions.length === 1) {
      if (window.confirm(text)) actions[0].onPress?.();
      else cancel?.onPress?.();
      return;
    }
    for (const b of actions) {
      if (window.confirm(`${text}\n\n${b.text}?`)) {
        b.onPress?.();
        return;
      }
    }
    cancel?.onPress?.();
  },
};

/** Asks before an action that's hard to undo; `run` only happens on the destructive button. */
export function confirmAction(title: string, message: string, label: string, run: () => void) {
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: run }]);
}
