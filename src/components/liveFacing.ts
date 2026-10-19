import { createContext, useContext } from 'react';

export type Facing = 'user' | 'environment';

/** Which camera the host is using, shared by the stage (mirroring) and the Flip control. */
export const FacingContext = createContext<{ facing: Facing; setFacing: (f: Facing) => void }>({ facing: 'user', setFacing: () => {} });

export function useFacing() {
  return useContext(FacingContext);
}
