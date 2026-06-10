// GameProvider — session-level XP/level state feeding the XpBar. Updated from
// every check-in/undo response (both carry {xpTotal, level}), and seeded on
// app load from GET /stats by Layout (Task 18) so the bar survives reloads;
// the level-1 default only shows until that first fetch lands. The context
// object + useGame hook live in hooks/useGame.ts (react-refresh
// only-export-components).

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
