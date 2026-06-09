// GameContext plumbing — context object, types and the useGame hook live in
// this hook-only file (react-refresh wants component files to export only
// components); the <GameProvider> component itself is in ../game.tsx.

import { createContext, useContext } from 'react';

export const XP_PER_LEVEL = 1000;

export interface GameXp {
  xpTotal: number;
  level: number;
  /** XP into the current level. */
  into: number;
  /** XP needed per level. */
  needed: number;
}

export interface GameContextValue extends GameXp {
  /** Feed the latest server-truth XP snapshot (checkin/undo/stats response). */
  applyXp: (snapshot: { xpTotal: number; level: number }) => void;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (ctx === null) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
