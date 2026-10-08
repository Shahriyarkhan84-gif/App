import { render, screen } from '@testing-library/react-native';

import { FramedAvatar } from '../FramedAvatar';

const rose = { id: 'rose_gold', name: 'Rose Gold', style: { colors: ['#F9A8D4', '#F472B6'], glow: '#F472B6', icon: null }, coin_price: 300, duration_days: 30 };

jest.mock('@/lib/frames', () => ({
  useFrameCatalog: () => ({ data: [rose] }),
}));

describe('FramedAvatar', () => {
  it('shows the plain avatar when no frame is worn', async () => {
    await render(<FramedAvatar name="Ayesha" size={60} />);
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByTestId('frame-ring')).toBeNull();
  });

  it('draws the worn frame from the catalog', async () => {
    await render(<FramedAvatar name="Ayesha" size={60} frameId="rose_gold" />);
    expect(screen.getByTestId('frame-ring')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('falls back to the plain avatar for a frame that is no longer sold', async () => {
    await render(<FramedAvatar name="Ayesha" size={60} frameId="retired_frame" />);
    expect(screen.queryByTestId('frame-ring')).toBeNull();
  });
});
