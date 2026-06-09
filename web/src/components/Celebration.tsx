// Celebration modal — CSS-only confetti burst (no library): ~20 absolutely-
// positioned colored squares falling with randomized inline-style transforms.
// Shown when a check-in levels you up and/or unlocks achievements.
// Auto-dismisses after 2.5s, or tap anywhere to dismiss.

import { useEffect, useMemo, type CSSProperties } from 'react';
import type { Achievement } from '../types';

export interface CelebrationData {
  /** New level when the check-in leveled up, else null. */
  level: number | null;
  unlockedAchievements: Achievement[];
}

interface CelebrationProps extends CelebrationData {
  onClose: () => void;
}

const CONFETTI_COLORS = [
  '#f44336',
  '#ff9800',
  '#ffd54f',
  '#66bb6a',
  '#29b6f6',
  '#5e35b1',
  '#ec407a',
];
const CONFETTI_COUNT = 20;

function makeConfetti(): CSSProperties[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    animationDelay: `${Math.random() * 0.4}s`,
    animationDuration: `${1.4 + Math.random() * 1.1}s`,
    // Each square gets its own spin direction/extent via a CSS variable
    // consumed by the keyframes.
    ['--confetti-spin' as string]: `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)}deg`,
  }));
}

export default function Celebration({ level, unlockedAchievements, onClose }: CelebrationProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [onClose]);

  const confetti = useMemo(() => makeConfetti(), []);

  return (
    <div
      className="celebration-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Celebration"
      onClick={onClose}
    >
      {confetti.map((style, i) => (
        <span key={i} className="confetti" style={style} aria-hidden="true" />
      ))}
      <div className="celebration-card">
        {level !== null && <p className="celebration-level">🎉 Level {level}!</p>}
        {unlockedAchievements.map((a) => (
          <p key={a.id} className="celebration-badge">
            <span className="celebration-badge-emoji">{a.emoji}</span> {a.name}
          </p>
        ))}
        <p className="celebration-hint">Tap to continue</p>
      </div>
    </div>
  );
}
