// Dumb XP progress bar — gets level/into/needed from the page. Task 14 swaps
// the data source to GameContext; this component stays as-is.

interface XpBarProps {
  level: number;
  into: number;
  needed: number;
}

export default function XpBar({ level, into, needed }: XpBarProps) {
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
