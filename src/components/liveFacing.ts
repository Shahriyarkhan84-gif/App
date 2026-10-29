import { createContext, useContext } from 'react';

export type Facing = 'user' | 'environment';

/**
 * Which camera the host is using and whether their own preview is mirrored, shared by the stage and
 * the host tools (Flip, Mirror). Mirror only changes the host's own view; viewers always see the
 * camera as it is.
 */
export const FacingContext = createContext<{ facing: Facing; setFacing: (f: Facing) => void; mirror: boolean; setMirror: (m: boolean) => void }>({
  facing: 'user', setFacing: () => {}, mirror: true, setMirror: () => {},
});

export function useFacing() {
  return useContext(FacingContext);
}
