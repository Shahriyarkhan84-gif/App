import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { Button, Chip, IconButton } from '../ui';

beforeEach(() => jest.clearAllMocks());

describe('Button', () => {
  it('shows its title and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<Button title="Sign in" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled, and says so to screen readers', async () => {
    const onPress = jest.fn();
    await render(<Button title="Continue" disabled onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Continue' });
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
    expect(btn).toBeDisabled();
  });

  it('gives a light tap vibration when pressed', async () => {
    await render(<Button title="Go" onPress={() => {}} />);
    await fireEvent(screen.getByRole('button', { name: 'Go' }), 'pressIn');
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is reachable by its label', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="wallet-outline" label="Wallet" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Wallet' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Chip', () => {
  it('reports whether it is selected', async () => {
    await render(<><Chip label="All" selected /><Chip label="Music" /></>);
    expect(screen.getByRole('button', { name: 'All' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Music' })).not.toBeSelected();
  });
});
