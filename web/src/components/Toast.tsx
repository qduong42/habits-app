// Small floating "+10 XP" / "+35 XP" chip rendered near the tapped habit row.
// Pure CSS animation (rise + fade); calls onDone after ~1.2s so the parent
// can clear it. Re-key on every show to restart the animation.

import { useEffect } from 'react';

interface ToastProps {
  text: string;
  onDone: () => void;
}

export default function Toast({ text, onDone }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <span className="xp-toast" role="status">
      {text}
    </span>
  );
}
