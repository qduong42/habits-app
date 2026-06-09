// GameProvider — session-level XP/level state feeding the XpBar. Updated from
// every check-in/undo response (both carry {xpTotal, level}). There is no
// /stats endpoint yet (Task 17); until the first mutation responds we show
// the level-1 default, and Task 18 can later seed the context from /stats via
// the same applyXp call. The context object + useGame hook live in
// hooks/useGame.ts (react-refresh only-export-components).

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { GameContext, XP_PER_LEVEL, type GameXp } from './hooks/useGame';

const DEFAULT_XP: GameXp = { xpTotal: 0, level: 1, into: 0, needed: XP_PER_LEVEL };

export function GameProvider({ children }: { children: ReactNode }) {
  const [xp, setXp] = useState<GameXp>(DEFAULT_XP);
  const applyXp = useCallback(({ xpTotal, level }: { xpTotal: number; level: number }) => {
    setXp({ xpTotal, level, into: xpTotal % XP_PER_LEVEL, needed: XP_PER_LEVEL });
  }, []);
  const value = useMemo(() => ({ ...xp, applyXp }), [xp, applyXp]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
