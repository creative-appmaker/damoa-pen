import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Lock, Delete } from 'lucide-react';

// ── Hash helper (simple djb2-like, not cryptographic) ────────────────────────
export function hashSecret(val: string): string {
  const s = val + ':damoa-pen-lock-v1';
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

export const LOCK_KEY   = 'damoa_pen_lock_enabled';
export const TYPE_KEY   = 'damoa_pen_lock_type';
export const HASH_KEY   = 'damoa_pen_lock_hash';
export const HINT_KEY   = 'damoa_pen_lock_hint';

// ── Pattern dot positions (3×3) ──────────────────────────────────────────────
const DOTS = Array.from({ length: 9 }, (_, i) => ({
  col: i % 3,
  row: Math.floor(i / 3),
  idx: i,
}));

const DOT_RADIUS  = 14;
const CELL_SIZE   = 80;
const GRID_OFFSET = CELL_SIZE / 2;
const SVG_SIZE    = CELL_SIZE * 3;

function dotCenter(d: typeof DOTS[number]) {
  return {
    x: GRID_OFFSET + d.col * CELL_SIZE,
    y: GRID_OFFSET + d.row * CELL_SIZE,
  };
}

// ── Pattern component ────────────────────────────────────────────────────────
interface PatternInputProps {
  onComplete: (pattern: number[]) => void;
  minDots?: number;
  label?: string;
  error?: boolean;
}

export const PatternInput: React.FC<PatternInputProps> = ({
  onComplete, minDots = 4, label, error,
}) => {
  const [selected, setSelected]   = useState<number[]>([]);
  const [pointer,  setPointer]    = useState<{x:number;y:number}|null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const reset = useCallback(() => {
    setSelected([]); setPointer(null); dragging.current = false;
  }, []);

  // Convert client → SVG coords
  const toSvg = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width)  * SVG_SIZE,
      y: ((clientY - r.top)  / r.height) * SVG_SIZE,
    };
  };

  // Hit-test a dot
  const hitDot = (x: number, y: number): number | null => {
    for (const d of DOTS) {
      const c = dotCenter(d);
      if (Math.hypot(x - c.x, y - c.y) <= DOT_RADIUS * 1.8) return d.idx;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    dragging.current = true;
    const pos = toSvg(e.clientX, e.clientY);
    const hit = hitDot(pos.x, pos.y);
    if (hit !== null) setSelected([hit]);
    setPointer(pos);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const pos = toSvg(e.clientX, e.clientY);
    setPointer(pos);
    const hit = hitDot(pos.x, pos.y);
    if (hit !== null && !selected.includes(hit)) {
      setSelected(prev => [...prev, hit]);
    }
  };

  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setPointer(null);
    if (selected.length >= minDots) onComplete([...selected]);
    setTimeout(reset, 300);
  };

  // Build SVG path segments
  const linePoints = selected.map(idx => dotCenter(DOTS[idx]));

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      {label && (
        <p className={`text-sm font-bold text-center ${error ? 'text-red-500' : 'text-stone-500 dark:text-slate-400'}`}>
          {label}
        </p>
      )}

      {/* Dot count indicator */}
      <div className="flex gap-1.5 h-3 items-center">
        {Array.from({ length: selected.length }, (_, i) => (
          <span key={i} className={`w-2 h-2 rounded-full ${error ? 'bg-red-500' : 'bg-purple-500'}`}/>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        width={SVG_SIZE} height={SVG_SIZE}
        className="touch-none cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
      >
        {/* Lines between selected dots */}
        {linePoints.map((p, i) => {
          if (i === 0) return null;
          const prev = linePoints[i-1];
          return (
            <line key={i}
              x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
              stroke={error ? '#ef4444' : '#8b5cf6'}
              strokeWidth="3" strokeLinecap="round" opacity="0.8"/>
          );
        })}
        {/* Line from last dot to pointer */}
        {pointer && linePoints.length > 0 && (
          <line
            x1={linePoints[linePoints.length-1].x}
            y1={linePoints[linePoints.length-1].y}
            x2={pointer.x} y2={pointer.y}
            stroke={error ? '#ef4444' : '#a78bfa'}
            strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3" opacity="0.6"/>
        )}
        {/* Dots */}
        {DOTS.map(d => {
          const c = dotCenter(d);
          const isOn = selected.includes(d.idx);
          return (
            <g key={d.idx}>
              <circle cx={c.x} cy={c.y} r={DOT_RADIUS + 8} fill="transparent"/>
              <circle cx={c.x} cy={c.y} r={DOT_RADIUS}
                fill={isOn ? (error ? '#ef4444' : '#8b5cf6') : 'transparent'}
                stroke={isOn ? (error ? '#ef4444' : '#7c3aed') : '#d1d5db'}
                strokeWidth="2"
                className="dark:stroke-slate-600"
              />
              {isOn && (
                <circle cx={c.x} cy={c.y} r={DOT_RADIUS * 0.38}
                  fill="white" opacity="0.9"/>
              )}
              {/* Order number inside active dot */}
              {isOn && (
                <text x={c.x} y={c.y + 4} textAnchor="middle"
                  fill="white" fontSize="10" fontWeight="bold">
                  {selected.indexOf(d.idx) + 1}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <button type="button" onClick={reset}
        className="text-xs font-bold text-stone-400 hover:text-stone-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer">
        다시 그리기
      </button>
    </div>
  );
};

// ── PIN pad component ────────────────────────────────────────────────────────
interface PinInputProps {
  onComplete: (pin: string) => void;
  length?: number;
  label?: string;
  error?: boolean;
}

export const PinInput: React.FC<PinInputProps> = ({
  onComplete, length = 6, label, error,
}) => {
  const [digits, setDigits] = useState('');

  const press = (d: string) => {
    const next = digits + d;
    setDigits(next);
    if (next.length === length) {
      onComplete(next);
      setTimeout(() => setDigits(''), 300);
    }
  };

  const del = () => setDigits(prev => prev.slice(0, -1));
  const clear = () => setDigits('');

  const rows = [['1','2','3'],['4','5','6'],['7','8','9'],['←','0','×']];

  return (
    <div className="flex flex-col items-center gap-4">
      {label && (
        <p className={`text-sm font-bold text-center ${error?'text-red-500':'text-stone-500 dark:text-slate-400'}`}>{label}</p>
      )}
      {/* Dots */}
      <div className="flex gap-3">
        {Array.from({ length }, (_, i) => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${
            i < digits.length
              ? (error ? 'bg-red-500 border-red-500' : 'bg-purple-600 border-purple-600')
              : 'border-stone-300 dark:border-slate-600'
          }`}/>
        ))}
      </div>
      {/* Numpad */}
      <div className="grid grid-cols-3 gap-2.5">
        {rows.flat().map((key, ki) => (
          <button key={ki} type="button"
            onClick={() => { if (key==='←') del(); else if (key==='×') clear(); else press(key); }}
            className={`w-16 h-14 rounded-2xl font-black text-lg flex items-center justify-center cursor-pointer active:scale-95 transition-transform shadow-sm ${
              key==='←'||key==='×'
                ? 'bg-stone-100 dark:bg-slate-800 text-stone-600 dark:text-slate-300 text-base'
                : 'bg-white dark:bg-slate-800 border border-stone-200 dark:border-slate-700 text-stone-900 dark:text-slate-100 hover:bg-purple-50 dark:hover:bg-purple-950/40'
            }`}>
            {key==='←' ? <Delete className="w-5 h-5"/> : key}
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Full-screen Lock Screen ──────────────────────────────────────────────────
interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const lockType = (localStorage.getItem(TYPE_KEY) || 'pattern') as 'pattern'|'pin';
  const storedHash = localStorage.getItem(HASH_KEY) || '';
  const hint = localStorage.getItem(HINT_KEY) || '';

  const [error,    setError]    = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [blocked,  setBlocked]  = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Shake error feedback
  const showError = () => {
    setError(true);
    setAttempts(a => {
      const next = a + 1;
      if (next >= 5) {
        setBlocked(true);
        let t = 30;
        setCountdown(t);
        const iv = setInterval(() => {
          t--; setCountdown(t);
          if (t <= 0) { clearInterval(iv); setBlocked(false); setAttempts(0); }
        }, 1000);
      }
      return next;
    });
    setTimeout(() => setError(false), 800);
  };

  const verify = (value: string) => {
    if (blocked) return;
    if (hashSecret(value) === storedHash) {
      onUnlock();
    } else {
      showError();
    }
  };

  const handlePattern = (pattern: number[]) => verify(pattern.join(','));
  const handlePin     = (pin: string)       => verify(pin);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 select-none">
      {/* Lock icon + title */}
      <div className="flex flex-col items-center mb-8">
        <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-4 shadow-lg transition-all
          ${error ? 'bg-red-500 animate-[shake_0.3s_ease-in-out]' : 'bg-purple-600'}`}>
          <Lock className="w-8 h-8 text-white"/>
        </div>
        <h1 className="text-2xl font-black text-white">다모아 펜</h1>
        <p className="text-sm text-slate-400 mt-1">
          {lockType === 'pattern' ? '패턴을 그려 잠금 해제' : 'PIN을 입력하세요'}
        </p>
        {hint && (
          <p className="text-xs text-slate-500 mt-1">힌트: {hint}</p>
        )}
      </div>

      {/* Blocked state */}
      {blocked ? (
        <div className="bg-red-900/40 border border-red-700 rounded-2xl px-6 py-4 text-center">
          <p className="text-red-300 font-black text-lg">{countdown}초 후 다시 시도</p>
          <p className="text-red-400 text-sm mt-1">시도 횟수 초과</p>
        </div>
      ) : lockType === 'pattern' ? (
        <div className={error ? 'animate-[shake_0.3s_ease-in-out]' : ''}>
          <PatternInput
            onComplete={handlePattern}
            error={error}
            label={error ? `잘못된 패턴입니다 (${attempts}/5)` : undefined}
          />
        </div>
      ) : (
        <div className={error ? 'animate-[shake_0.3s_ease-in-out]' : ''}>
          <PinInput
            onComplete={handlePin}
            error={error}
            label={error ? `잘못된 PIN입니다 (${attempts}/5)` : undefined}
          />
        </div>
      )}

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%,60%{transform:translateX(-8px)}
          40%,80%{transform:translateX(8px)}
        }
      `}</style>
    </div>
  );
};
