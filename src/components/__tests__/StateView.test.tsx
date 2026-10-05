import { render, screen } from '@testing-library/react-native';
import type { RefreshControl } from 'react-native';

import { StateView } from '../StateView';

it('error screens scroll and pull-to-refresh retries', async () => {
  const onRetry = jest.fn();
  await render(<StateView state={{ kind: 'error', error: new Error('connection_lost'), onRetry }} />);
  expect(screen.getByText('The connection to the stream was lost.')).toBeTruthy();
  const scroll = screen.getByTestId('state-view-scroll');
  const refresh = scroll.props.refreshControl as React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  expect(refresh).toBeTruthy();
  refresh.props.onRefresh?.();
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('empty screens scroll but have nothing to refresh', async () => {
  await render(<StateView state={{ kind: 'empty', title: 'Nothing here' }} />);
  expect(screen.getByText('Nothing here')).toBeTruthy();
  expect(screen.getByTestId('state-view-scroll').props.refreshControl).toBeUndefined();
});
