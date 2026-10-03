import { fireEvent, render, screen } from '@testing-library/react-native';

import { TabBarItem, tabButton } from '../Menus';

describe('TabBarItem', () => {
  it('marks the focused tab as selected and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<TabBarItem icon="home-outline" activeIcon="home" label="Home" focused onPress={onPress} />);
    const tab = screen.getByRole('tab', { name: 'Home' });
    expect(tab).toBeSelected();
    await fireEvent.press(tab);
    expect(onPress).toHaveBeenCalled();
  });

  it('shows the filled icon only when focused', async () => {
    await render(<TabBarItem icon="home-outline" activeIcon="home" label="Home" focused={false} />);
    expect(screen.getByText('icon:home-outline')).toBeOnTheScreen();
  });
});

describe('tabButton (router tab bar)', () => {
  const Explore = tabButton('compass-outline', 'compass', 'Explore');

  // Regression: the navigator reports focus as `aria-selected`. Reading only
  // `accessibilityState.selected` left every tab looking inactive.
  it('reads focus from aria-selected', async () => {
    await render(<Explore aria-selected />);
    expect(screen.getByRole('tab', { name: 'Explore' })).toBeSelected();
    expect(screen.getByText('icon:compass')).toBeOnTheScreen();
  });

  it('still accepts accessibilityState.selected', async () => {
    await render(<Explore accessibilityState={{ selected: true }} />);
    expect(screen.getByRole('tab', { name: 'Explore' })).toBeSelected();
  });

  it('is not selected when neither is set', async () => {
    await render(<Explore />);
    expect(screen.getByRole('tab', { name: 'Explore' })).not.toBeSelected();
  });
});
