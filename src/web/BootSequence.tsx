import { useEffect, useState } from "react";

export function BootSequence() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leaveAfter = reducedMotion ? 80 : 720;
    const removeAfter = reducedMotion ? 140 : 1120;

    const leaveTimer = window.setTimeout(() => setLeaving(true), leaveAfter);
    const removeTimer = window.setTimeout(() => setVisible(false), removeAfter);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`boot-sequence${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-label="Opening OMP workspace"
      aria-live="polite"
    >
      <div className="boot-sequence-inner">
        <div className="boot-symbol" aria-hidden="true">
          <span>π</span>
          <i />
        </div>
        <div className="boot-wordmark" aria-hidden="true">
          <strong>omp</strong>
          <span>web workspace</span>
        </div>
        <div className="boot-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
