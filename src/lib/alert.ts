// Native: React Native's Alert. Web has its own implementation in alert.web.ts.
import { Alert } from 'react-native';

export { Alert };

/** Asks before an action that's hard to undo; `run` only happens on the destructive button. */
export function confirmAction(title: string, message: string, label: string, run: () => void) {
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: run }]);
}
