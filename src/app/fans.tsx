import { FansList } from '@/components/FansList';
import { Screen } from '@/components/ui';

/** My fans: everyone who follows you, newest first (same list as Messages → Fans). */
export default function MyFansScreen() {
  return (
    <Screen edges={['bottom']} style={{ paddingTop: 12 }}>
      <FansList bottomInset={32} />
    </Screen>
  );
}
