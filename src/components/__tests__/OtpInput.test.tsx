import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { OtpInput } from '../OtpInput';

function Harness({ onComplete }: { onComplete: (code: string) => void }) {
  const [code, setCode] = useState('');
  return <OtpInput value={code} onChange={setCode} onComplete={onComplete} />;
}

describe('OtpInput', () => {
  it('keeps digits only, shows them in the boxes and submits at six digits', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    const input = screen.getByLabelText('Verification code, 6 digits');

    await fireEvent.changeText(input, '12a3');
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    // Paste / autofill of the whole code (extra characters are dropped).
    await fireEvent.changeText(input, '987654321');
    expect(onComplete).toHaveBeenCalledWith('987654');
    expect(screen.getByText('4')).toBeTruthy();
  });
});
