// XP progress bar — reads level/into/needed from GameContext (server truth
// from the latest check-in/undo response; level-1 default before any).

import { useGame } from '../hooks/useGame';

export default function XpBar() {
  const { level, into, needed } = useGame();
  const pct = needed > 0 ? Math.min(100, (into / needed) * 100) : 0;
  return (
    <div className="xp-bar">
      <div className="xp-track" role="progressbar" aria-valuenow={into} aria-valuemax={needed}>
        <div className="xp-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="xp-meta">
        <span>Lv {level}</span>
        <span>
          {into} / {needed} XP
        </span>
      </div>
    </div>
  );
}
