import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CommandLineIcon,
  File02Icon,
  PencilEdit01Icon,
  RefreshIcon,
  Search01Icon,
  Tick02Icon
} from '@hugeicons/core-free-icons';

import './CallChip.css';

const HOLD_AT = 0.9;
const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0];
const ICONS: Record<string, unknown> = {
  terminal: CommandLineIcon,
  file: File02Icon,
  search: Search01Icon,
  edit: PencilEdit01Icon
};
const WORDS: Record<string, string> = { running: 'running', done: 'done', error: 'failed', idle: 'queued' };

const fmt = (ms: number) => (ms < 10000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const reduceMotion = () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ?? false;
const glyphOf = (s: string) => (s === 'done' ? 'check' : s === 'error' ? 'retry' : 'tool');

export interface CallChipProps {
  icon?: 'terminal' | 'file' | 'search' | 'edit' | ReactNode;
  name?: string;
  argument?: string;
  status?: 'idle' | 'running' | 'done' | 'error';
  expectedMs?: number;
  size?: number;
  radius?: number;
  color?: string;
  surfaceColor?: string;
  progressColor?: string;
  progressOpacity?: number;
  doneColor?: string;
  errorColor?: string;
  washOpacity?: number;
  shake?: number;
  showTimer?: boolean;
  showChevron?: boolean;
  isOpen?: boolean;
  onRetry?: () => void;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

export default function CallChip({
  icon = 'terminal',
  name = 'bash',
  argument = 'npm test',
  status = 'running',
  expectedMs = 2500,
  size = 34,
  radius = 10,
  color = 'currentColor',
  surfaceColor = '#27272a',
  progressColor = 'currentColor',
  progressOpacity = 0.08,
  doneColor = '#22c55e',
  errorColor = '#ef4444',
  washOpacity = 0.14,
  shake = 6,
  showTimer = true,
  showChevron = false,
  isOpen = false,
  onRetry,
  onClick,
  className = '',
  style
}: CallChipProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<HTMLSpanElement | null>(null);
  const mountedRef = useRef(false);
  const fraction = useRef(0);
  const clock = useRef({ ms: 0 });
  const shakeAnim = useRef<Animation | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [mounted, setMounted] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const roll = useRef<{ cur: string; prev: string | null }>({ cur: glyphOf(status), prev: null });
  if (glyphOf(status) !== roll.current.cur) roll.current = { cur: glyphOf(status), prev: roll.current.cur };

  const setFraction = (f: number, instant: boolean) => {
    const fill = fillRef.current;
    if (!fill) return;
    fraction.current = f;
    if (instant) fill.style.transition = 'none';
    fill.style.transform = `scaleX(${f})`;
    if (instant) {
      void fill.getBoundingClientRect();
      fill.style.transition = '';
    }
  };
  const apply = (s: string, animate: boolean) => {
    if (s === 'running') {
      shakeAnim.current?.cancel();
      setFraction(0, true);
      if (animate) setFraction(HOLD_AT, false);
    } else if (s === 'done') {
      setFraction(1, !animate);
    } else if (s === 'error') {
      const fill = fillRef.current;
      const live = fill ? new DOMMatrix(getComputedStyle(fill).transform).a : fraction.current;
      setFraction(Math.min(1, Math.max(0, live)), true);
      if (animate && shake > 0 && !reduceMotion() && rootRef.current) {
        shakeAnim.current = rootRef.current.animate(
          SHAKE.map(k => ({ transform: `translateX(${k * shake}px)`, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' })),
          { duration: 450, composite: 'add' }
        );
      }
    } else setFraction(0, true);
  };

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    apply(statusRef.current, statusRef.current === 'running');
    return () => {
      mountedRef.current = false;
      shakeAnim.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    if (mountedRef.current) apply(status, true);
  }, [status]);

  useEffect(() => {
    const write = (ms: number) => {
      clock.current.ms = ms;
      if (timerRef.current) timerRef.current.textContent = fmt(ms);
    };
    if (status !== 'running') {
      if ((status === 'idle' || !clock.current.ms) && timerRef.current) timerRef.current.textContent = '—';
      return undefined;
    }
    const startedAt = performance.now();
    write(0);
    if (reduceMotion()) {
      const id = setInterval(() => write(performance.now() - startedAt), 100);
      return () => {
        clearInterval(id);
        write(performance.now() - startedAt);
      };
    }
    let raf = 0;
    const tick = () => {
      write(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      write(performance.now() - startedAt);
    };
  }, [status]);

  useEffect(() => {
    const ms = showTimer && clock.current.ms ? Math.round(clock.current.ms) : 0;
    const when = status === 'done' && ms ? ` in ${ms} ms` : status === 'error' && ms ? ` after ${ms} ms` : '';
    setAnnounce(`${name} ${argument}, ${WORDS[status] ?? status}${when}`);
  }, [status, name, argument, showTimer]);

  const font = Math.max(11, Math.round(size * 0.38));
  const glyphState = (g: string) => (g === roll.current.cur ? 'in' : g === roll.current.prev ? 'out' : undefined);
  const toolIcon = typeof icon === 'string' ? (ICONS[icon] ?? ICONS.terminal) : null;
  const iconSize = font + 2;

  return (
    <span
      ref={rootRef}
      role={onClick ? 'button' : 'status'}
      tabIndex={onClick ? 0 : undefined}
      aria-busy={status === 'running' || undefined}
      data-status={status}
      data-mounted={mounted ? '' : undefined}
      data-pressed={pressed ? '' : undefined}
      data-clickable={onClick ? '' : undefined}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`call-chip${className ? ` ${className}` : ''}`}
      style={{
        '--cc-size': `${size}px`,
        '--cc-font': `${font}px`,
        '--cc-pad': `${Math.round(size * 0.35)}px`,
        '--cc-gap': `${Math.round(font * 0.55)}px`,
        '--cc-radius': `${radius}px`,
        '--cc-color': color,
        '--cc-surface': surfaceColor,
        '--cc-progress': progressColor,
        '--cc-progress-pct': `${progressOpacity * 100}%`,
        '--cc-done': doneColor,
        '--cc-error': errorColor,
        '--cc-wash-pct': `${washOpacity * 100}%`,
        '--cc-expected': `${expectedMs}ms`,
        ...style
      } as CSSProperties}
    >
      <span ref={fillRef} className="call-chip__fill" aria-hidden="true" />
      <span className="call-chip__slot" aria-hidden="true">
        <span className="call-chip__glyph" data-state={glyphState('tool')}>
          {toolIcon ? (
            <HugeiconsIcon icon={toolIcon as Parameters<typeof HugeiconsIcon>[0]['icon']} size={iconSize} strokeWidth={1.8} />
          ) : (
            (icon as ReactNode)
          )}
        </span>
        <span className="call-chip__glyph" data-state={glyphState('check')}>
          <HugeiconsIcon icon={Tick02Icon} size={iconSize} strokeWidth={2.2} />
        </span>
        <span className="call-chip__glyph" data-state={glyphState('retry')}>
          <HugeiconsIcon icon={RefreshIcon} size={iconSize} strokeWidth={2} />
        </span>
      </span>
      <span className="call-chip__name" aria-hidden="true">
        {name}
      </span>
      <span className="call-chip__arg" aria-hidden="true">
        {argument}
      </span>
      {showTimer ? (
        <span ref={timerRef} className="call-chip__timer" aria-hidden="true">
          0 ms
        </span>
      ) : null}
      {showChevron ? (
        <span className={`call-chip__chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1L5 5L9 1" />
          </svg>
        </span>
      ) : null}
      {status === 'error' && onRetry ? (
        <button
          type="button"
          className="call-chip__retry"
          aria-label={`Retry ${name} ${argument}`}
          onClick={() => onRetry()}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerCancel={() => setPressed(false)}
        />
      ) : null}
      <span className="call-chip__sr">{announce}</span>
    </span>
  );
}
