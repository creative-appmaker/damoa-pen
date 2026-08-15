import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Eraser, Trash2, Check, Sparkles,
  Hand, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
} from 'lucide-react';
import { PenNote } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────
interface Point { x: number; y: number; pressure: number; t?: number; }

type PenType = 'pen' | 'fountain' | 'highlighter';

interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  penType: PenType;
  fountainIntensity: number; // 0.5~2.5, only used when penType === 'fountain'
}

interface Props {
  editingNote: PenNote | null;
  darkMode: boolean;
  onSave: (dataUrl: string, ocrText: string, title: string, paperType: 'white'|'yellow'|'black', id?: string) => void;
  onBack: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────
const COLOR_PALETTE = [
  '#1c1917','#57534e','#a8a29e','#ffffff',
  '#ef4444','#f97316','#eab308','#22c55e',
  '#06b6d4','#2563eb','#8b5cf6','#ec4899',
];

// Highlighter colors (pastel)
const HL_COLORS = ['#fde047','#86efac','#93c5fd','#f9a8d4','#fdba74','#a5f3fc'];

const QUICK_SIZES = [0.5, 1, 2, 3.5, 6, 10, 16, 20];

const PEN_LABELS: Record<PenType, string> = {
  pen:         '볼펜',
  fountain:    '만년필',
  highlighter: '형광펜',
};

const PEN_ICONS: Record<PenType, string> = {
  pen:         '🖊️',
  fountain:    '✒️',
  highlighter: '🖍️',
};

// ── Compress helper ──────────────────────────────────────────────────────────
const compress = (dataUrl: string, maxW = 1200, q = 0.78): Promise<string> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

// ── Drawing helpers ──────────────────────────────────────────────────────────
function applyPenStyle(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'color'|'size'|'penType'|'fountainIntensity'>,
  pressure = 1,
) {
  const { color, size, penType, fountainIntensity } = stroke;
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  if (penType === 'highlighter') {
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = Math.max(8, size * 4);
    ctx.globalCompositeOperation = 'source-over';
  } else if (penType === 'fountain') {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.globalCompositeOperation = 'source-over';
    const p = Math.max(0.2, Math.min(pressure, 1));
    ctx.lineWidth   = Math.max(0.4, size * p * fountainIntensity);
  } else {
    // ballpoint pen: uniform
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = Math.max(0.4, size);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function resetCtxState(ctx: CanvasRenderingContext2D) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawStroke(stroke: Stroke, ctx: CanvasRenderingContext2D) {
  const pts = stroke.points;
  if (!pts?.length) return;

  if (stroke.penType === 'fountain') {
    // Per-segment varying width
    if (pts.length === 1) {
      const p = pts[0];
      applyPenStyle(ctx, stroke, p.pressure);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.4, ctx.lineWidth / 2), 0, Math.PI * 2);
      ctx.fill();
      resetCtxState(ctx); return;
    }
    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i-1], p2 = pts[i];
      const avgP = (p1.pressure + p2.pressure) / 2;
      applyPenStyle(ctx, stroke, avgP);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    resetCtxState(ctx); return;
  }

  // Pen & highlighter: smooth bezier
  const avgP = pts.reduce((a, p) => a + p.pressure, 0) / pts.length;
  applyPenStyle(ctx, stroke, avgP);

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.4, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    resetCtxState(ctx); return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2;
      const my = (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  ctx.stroke();
  resetCtxState(ctx);
}

function appendSegment(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'color'|'size'|'penType'|'fountainIntensity'>,
  pts: Point[],
) {
  if (pts.length < 2) return;
  const len = pts.length;
  const p1 = pts[len-2], p2 = pts[len-1];

  if (stroke.penType === 'fountain') {
    const avgP = (p1.pressure + p2.pressure) / 2;
    applyPenStyle(ctx, stroke, avgP);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    resetCtxState(ctx); return;
  }

  const avgP = (p1.pressure + p2.pressure) / 2;
  applyPenStyle(ctx, stroke, avgP);

  if (len === 2) {
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  } else {
    const p0  = pts[len-3];
    const mx1 = (p0.x + p1.x) / 2, my1 = (p0.y + p1.y) / 2;
    const mx2 = (p1.x + p2.x) / 2, my2 = (p1.y + p2.y) / 2;
    ctx.beginPath(); ctx.moveTo(mx1, my1);
    ctx.quadraticCurveTo(p1.x, p1.y, mx2, my2); ctx.stroke();
  }
  resetCtxState(ctx);
}

// ── Component ────────────────────────────────────────────────────────────────
export const PenCanvas: React.FC<Props> = ({ editingNote, darkMode, onSave, onBack }) => {
  const baseCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef    = useRef<HTMLDivElement | null>(null);
  const isDrawingRef    = useRef(false);
  const currentStrokeRef= useRef<Stroke | null>(null);
  const strokesRef      = useRef<Stroke[]>([]);
  const baseImageRef    = useRef<HTMLImageElement | null>(null);
  const cachedRectRef   = useRef<DOMRect | null>(null);
  const rafPendingRef   = useRef(false);

  const initPT = editingNote?.paperType ?? (darkMode ? 'black' : 'white');

  const [title,             setTitle]             = useState(editingNote?.title ?? '');
  const [paperType,         setPaperType]         = useState<'white'|'yellow'|'black'>(initPT);
  const [penColor,          setPenColor]          = useState(initPT === 'black' ? '#ffffff' : '#1c1917');
  const [penSize,           setPenSize]           = useState(2);
  const [penSizeInput,      setPenSizeInput]      = useState('2.0'); // 직접 입력용 문자열
  const [penType,           setPenType]           = useState<PenType>('pen');
  const [fountainIntensity, setFountainIntensity] = useState(1.2);
  const [isEraser,          setIsEraser]          = useState(false);
  const [eraserType,        setEraserType]        = useState<'stroke'|'area'>('stroke');
  const [autoReturnPen,     setAutoReturnPen]     = useState(true);
  const [penOnlyMode,       setPenOnlyMode]       = useState(true);
  const [showLines,         setShowLines]         = useState(true);
  const [lineSpacing,       setLineSpacing]       = useState(30);
  const [ocrText,           setOcrText]           = useState(editingNote?.ocrText ?? '');
  const [isOcrLoading,      setIsOcrLoading]      = useState(false);
  const [ocrMsg,            setOcrMsg]            = useState<string | null>(null);
  const [toolbarCollapsed,  setToolbarCollapsed]  = useState(false);
  const [showColorPicker,   setShowColorPicker]   = useState(false);
  const [showSizePicker,    setShowSizePicker]    = useState(false);
  const [showPenMenu,       setShowPenMenu]       = useState(false);
  const [showEraserMenu,    setShowEraserMenu]    = useState(false);
  const [showPaperMenu,     setShowPaperMenu]     = useState(false);
  const [pages,   setPages]   = useState([{ id: 'p1', strokes: [] as Stroke[] }]);
  const [pageIdx, setPageIdx] = useState(0);

  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const sizePickerRef  = useRef<HTMLDivElement | null>(null);
  const penMenuRef     = useRef<HTMLDivElement | null>(null);
  const eraserMenuRef  = useRef<HTMLDivElement | null>(null);
  const paperMenuRef   = useRef<HTMLDivElement | null>(null);

  const live = useRef({
    penOnlyMode: true,
    penColor: initPT === 'black' ? '#ffffff' : '#1c1917',
    penSize: 2, penType: 'pen' as PenType, fountainIntensity: 1.2,
    isEraser: false, eraserType: 'stroke' as 'stroke'|'area',
    pageIdx: 0, autoReturnPen: true,
    paperType: initPT as 'white'|'yellow'|'black', showLines: true, lineSpacing: 30,
  });
  live.current.penOnlyMode        = penOnlyMode;
  live.current.penColor           = penColor;
  live.current.penSize            = penSize;
  live.current.penType            = penType;
  live.current.fountainIntensity  = fountainIntensity;
  live.current.isEraser           = isEraser;
  live.current.eraserType         = eraserType;
  live.current.pageIdx            = pageIdx;
  live.current.autoReturnPen      = autoReturnPen;
  live.current.paperType          = paperType;
  live.current.showLines          = showLines;
  live.current.lineSpacing        = lineSpacing;

  // ── Background ─────────────────────────────────────────────────────────
  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, cssW: number, cssH: number) => {
    const pt = live.current.paperType;
    ctx.fillStyle = pt === 'black' ? '#1a1a1a' : pt === 'yellow' ? '#fef9c3' : '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);
    if (live.current.showLines) {
      ctx.strokeStyle = pt === 'black' ? '#333' : pt === 'yellow' ? '#c4ad6a' : '#e5e7eb';
      ctx.lineWidth = 0.5;
      for (let y = live.current.lineSpacing; y < cssH; y += live.current.lineSpacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke();
      }
    }
  }, []);

  // ── Redraw ─────────────────────────────────────────────────────────────
  const redrawBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr, cssH = canvas.height / dpr;
    const ctx  = canvas.getContext('2d')!;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    drawBackground(ctx, cssW, cssH);
    if (baseImageRef.current) ctx.drawImage(baseImageRef.current, 0, 0, cssW, cssH);
    strokesRef.current.forEach(s => drawStroke(s, ctx));
  }, [drawBackground]);

  const clearActive = useCallback(() => {
    const ac = activeCanvasRef.current;
    if (!ac) return;
    const ctx = ac.getContext('2d')!;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0, 0, ac.width, ac.height); ctx.restore();
  }, []);

  // Export for saving
  const getExportDataUrl = (): string => {
    const base = baseCanvasRef.current, active = activeCanvasRef.current;
    if (!base) return '';
    const tmp = document.createElement('canvas');
    tmp.width = base.width; tmp.height = base.height;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    if (active) ctx.drawImage(active, 0, 0);
    return tmp.toDataURL('image/png');
  };

  // ── Canvas init ─────────────────────────────────────────────────────────
  const initCanvas = useCallback(() => {
    const base = baseCanvasRef.current, active = activeCanvasRef.current;
    if (!base || !active) return;
    const container = containerRef.current;
    const w = container?.clientWidth || 800, h = container?.clientHeight || 520;
    const dpr = window.devicePixelRatio || 1;
    [base, active].forEach(c => {
      c.width = w * dpr; c.height = h * dpr;
      c.style.width = `${w}px`; c.style.height = `${h}px`;
      const ctx = (c.getContext('2d', { desynchronized: true }) || c.getContext('2d')) as CanvasRenderingContext2D;
      ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    });
    cachedRectRef.current = base.getBoundingClientRect();
    redrawBase();
  }, [redrawBase]);

  // ── Load editing note ───────────────────────────────────────────────────
  useEffect(() => {
    if (editingNote?.dataUrl) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { baseImageRef.current = img; redrawBase(); };
      img.src = editingNote.dataUrl;
    } else {
      baseImageRef.current = null; strokesRef.current = [];
    }
    setOcrText(editingNote?.ocrText ?? '');
    setTitle(editingNote?.title ?? '');
    const pt = editingNote?.paperType ?? (darkMode ? 'black' : 'white');
    setPaperType(pt);
    setPenColor(pt === 'black' ? '#ffffff' : '#1c1917');
    live.current.paperType = pt;
  }, [editingNote, darkMode, redrawBase]);

  useEffect(() => {
    initCanvas();
    const obs = new ResizeObserver(() => initCanvas());
    if (containerRef.current) obs.observe(containerRef.current);
    const t1 = setTimeout(initCanvas, 50), t2 = setTimeout(initCanvas, 300);
    return () => { obs.disconnect(); clearTimeout(t1); clearTimeout(t2); };
  }, [initCanvas, pageIdx]);

  useEffect(() => { redrawBase(); }, [paperType, showLines, lineSpacing, redrawBase]);

  // ── Close dropdowns ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!showPaperMenu && !showColorPicker && !showSizePicker && !showEraserMenu && !showPenMenu) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node;
      if (colorPickerRef.current?.contains(t)) return;
      if (sizePickerRef.current?.contains(t))  return;
      if (penMenuRef.current?.contains(t))     return;
      if (eraserMenuRef.current?.contains(t))  return;
      if (paperMenuRef.current?.contains(t))   return;
      setShowColorPicker(false); setShowSizePicker(false);
      setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false);
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', handler); };
  }, [showPaperMenu, showColorPicker, showSizePicker, showEraserMenu, showPenMenu]);

  // ── Palm rejection (canvas only) ───────────────────────────────────────
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (live.current.penOnlyMode) { e.preventDefault(); e.stopPropagation(); }
    };
    [baseCanvasRef.current, activeCanvasRef.current].forEach(c => {
      if (!c) return;
      c.addEventListener('touchstart', block, { passive: false });
      c.addEventListener('touchmove',  block, { passive: false });
      c.addEventListener('touchend',   block, { passive: false });
    });
    return () => {
      [baseCanvasRef.current, activeCanvasRef.current].forEach(c => {
        if (!c) return;
        c.removeEventListener('touchstart', block);
        c.removeEventListener('touchmove',  block);
        c.removeEventListener('touchend',   block);
      });
    };
  }, []);

  // ── Eraser helper ───────────────────────────────────────────────────────
  const handleEraseAt = useCallback((pt: Point, et: 'stroke'|'area', ps: number) => {
    if (et === 'stroke') {
      const thr = Math.max(ps * 10 + 16, 24), thrSq = thr * thr;
      const rem: Stroke[] = []; let erased = false;
      for (const s of strokesRef.current) {
        let hit = false;
        for (const p of s.points) {
          const dx = p.x - pt.x, dy = p.y - pt.y;
          if (dx*dx + dy*dy <= thrSq) { hit = true; break; }
        }
        if (hit) erased = true; else rem.push(s);
      }
      if (erased) {
        strokesRef.current = rem;
        setPages(prev => prev.map((pg, i) => i === live.current.pageIdx ? { ...pg, strokes: rem } : pg));
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          requestAnimationFrame(() => { redrawBase(); rafPendingRef.current = false; });
        }
      }
    } else {
      const base = baseCanvasRef.current;
      if (base) {
        const ctx = base.getContext('2d')!;
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, ps * 6 + 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }, [redrawBase]);

  // ── Pointer events ──────────────────────────────────────────────────────
  useEffect(() => {
    const target = activeCanvasRef.current;
    if (!target) return;

    const onDown = (e: PointerEvent) => {
      const { penOnlyMode: pom, penColor: pc, penSize: ps, penType: pt,
              fountainIntensity: fi, isEraser: ie, eraserType: et } = live.current;
      if (pom && e.pointerType === 'touch') return;
      e.preventDefault();
      try { target.setPointerCapture(e.pointerId); } catch {}
      const rect = target.getBoundingClientRect();
      cachedRectRef.current = rect;
      const p: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure > 0 ? e.pressure : 0.5, t: Date.now() };
      isDrawingRef.current = true;
      if (ie) { handleEraseAt(p, et, ps); return; }

      const stroke: Stroke = { id: `s-${Date.now()}-${Math.random()}`, points: [p], color: pc, size: ps, penType: pt, fountainIntensity: fi };
      currentStrokeRef.current = stroke;

      // First dot on active canvas
      const ac = activeCanvasRef.current;
      if (ac) {
        const ctx = ac.getContext('2d')!;
        applyPenStyle(ctx, stroke, p.pressure);
        const r = Math.max(0.4, ctx.lineWidth / 2);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        resetCtxState(ctx);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      const { penOnlyMode: pom, penColor: pc, penSize: ps, penType: pt,
              fountainIntensity: fi, isEraser: ie, eraserType: et } = live.current;
      if (pom && e.pointerType === 'touch') return;
      const rect = cachedRectRef.current || target.getBoundingClientRect();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p: Point = { x: ev.clientX - rect.left, y: ev.clientY - rect.top, pressure: ev.pressure > 0 ? ev.pressure : 0.5, t: Date.now() };
        if (ie) { handleEraseAt(p, et, ps); continue; }
        if (!currentStrokeRef.current) continue;
        const pts = currentStrokeRef.current.points;
        const prev = pts[pts.length - 1];
        if (prev) { const dx = p.x - prev.x, dy = p.y - prev.y; if (dx*dx + dy*dy < 0.25) continue; }
        pts.push(p);
        const ac = activeCanvasRef.current;
        if (ac) appendSegment(ac.getContext('2d')!, { color: pc, size: ps, penType: pt, fountainIntensity: fi }, pts);
      }
    };

    const onUp = (e: PointerEvent) => {
      const { penOnlyMode: pom, autoReturnPen: arp, pageIdx: ci } = live.current;
      if (pom && e.pointerType === 'touch') return;
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      try { target.releasePointerCapture(e.pointerId); } catch {}
      if (currentStrokeRef.current) {
        const stroke = currentStrokeRef.current;
        strokesRef.current.push(stroke);
        setPages(prev => prev.map((pg, i) => i === ci ? { ...pg, strokes: [...strokesRef.current] } : pg));
        currentStrokeRef.current = null;
        const base = baseCanvasRef.current;
        if (base) drawStroke(stroke, base.getContext('2d')!);
        clearActive();
      }
      if (live.current.isEraser && arp) setIsEraser(false);
    };

    const onCancel = (e: PointerEvent) => { if (!live.current.penOnlyMode || e.pointerType !== 'touch') onUp(e); };

    target.addEventListener('pointerdown',   onDown,    { passive: false });
    target.addEventListener('pointermove',   onMove,    { passive: false });
    target.addEventListener('pointerup',     onUp);
    target.addEventListener('pointercancel', onCancel);
    return () => {
      target.removeEventListener('pointerdown',   onDown);
      target.removeEventListener('pointermove',   onMove);
      target.removeEventListener('pointerup',     onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
  }, [clearActive, handleEraseAt]);

  // ── Clear ───────────────────────────────────────────────────────────────
  const clearCanvas = () => {
    baseImageRef.current = null; strokesRef.current = [];
    setPages(prev => prev.map((pg, i) => i === pageIdx ? { ...pg, strokes: [] } : pg));
    redrawBase(); clearActive();
  };

  // ── OCR ─────────────────────────────────────────────────────────────────
  const handleOcr = async (customDataUrl?: string) => {
    const dataUrl = customDataUrl || getExportDataUrl();
    if (!dataUrl || strokesRef.current.length === 0) { setOcrMsg('캔버스가 비어있습니다.'); return ''; }
    const { isNativeAndroid } = await import('../lib/mlkitOcr');
    if (isNativeAndroid()) {
      // 1차 시도: ML Kit Digital Ink Recognition (스트로크 데이터 기반, 더 정확)
      setIsOcrLoading(true); setOcrMsg('✨ ML Kit 필기 인식 중 (오프라인)...');
      try {
        const { runInkOcr } = await import('../lib/inkOcr');
        const recognized = await runInkOcr(strokesRef.current);
        if (recognized) {
          setOcrText(recognized);
          setOcrMsg(`✨ Ink 인식: "${recognized.slice(0, 50)}${recognized.length > 50 ? '...' : ''}"`);
          setIsOcrLoading(false); return recognized;
        }
      } catch (inkErr) {
        console.warn('Ink OCR 실패, 이미지 OCR로 폴백:', inkErr);
      }
      // 2차 폴백: 이미지 기반 ML Kit OCR
      try {
        const { runMlKitOcr } = await import('../lib/mlkitOcr');
        const compressed = await compress(dataUrl, 1600, 0.85);
        const recognized = await runMlKitOcr(compressed);
        if (recognized) { setOcrText(recognized); setOcrMsg(`✨ ML Kit 이미지: "${recognized.slice(0,50)}..."`); }
        else setOcrMsg('인식하지 못했습니다.');
        setIsOcrLoading(false); return recognized;
      } catch { setOcrMsg('ML Kit 오류'); setIsOcrLoading(false); return ''; }
    }
    const apiKey = localStorage.getItem('damoa_gemini_api_key');
    if (!apiKey) { setOcrMsg('⚙️ 설정에서 Gemini API 키를 입력해주세요.'); return ''; }
    setIsOcrLoading(true); setOcrMsg('✨ Gemini AI 판독 중...');
    try {
      const compressed = await compress(dataUrl, 1600, 0.85);
      const m = compressed.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!m) { setIsOcrLoading(false); return ''; }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[
            {text:'이 손글씨 이미지에 쓰여진 텍스트를 정확하게 인식하여 원본 그대로 출력해주세요. 줄바꿈 유지, 인식 텍스트만 출력.'},
            {inline_data:{mime_type:`image/${m[1]}`,data:m[2]}}
          ]}], generationConfig:{maxOutputTokens:2048,temperature:0.1} }) }
      );
      if (!res.ok) { const d=await res.json().catch(()=>({})); setOcrMsg(`❌ ${d?.error?.message||`HTTP ${res.status}`}`); setIsOcrLoading(false); return ''; }
      const d = await res.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (text) { setOcrText(text); setOcrMsg(`✨ AI 인식: "${text.slice(0,50)}${text.length>50?'...':''}"`); }
      else setOcrMsg('인식하지 못했습니다.');
      setIsOcrLoading(false); return text;
    } catch { setOcrMsg('오류가 발생했습니다.'); setIsOcrLoading(false); return ''; }
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const rawUrl = getExportDataUrl();
    if (!rawUrl) return;
    const dataUrl = await compress(rawUrl, 1200, 0.75);
    let finalOcr = ocrText;
    if (strokesRef.current.length > 0 && !ocrText) {
      try { const t = await handleOcr(dataUrl); if (t) finalOcr = t; } catch {}
    }
    onSave(dataUrl, finalOcr, title, live.current.paperType, editingNote?.id);
  };

  // ── Pages ─────────────────────────────────────────────────────────────────
  const goToPage = (idx: number) => {
    setPageIdx(idx); strokesRef.current = pages[idx]?.strokes || [];
    baseImageRef.current = null; redrawBase(); clearActive();
  };
  const addPage = () => {
    const newPg = { id: `p-${pages.length+1}`, strokes: [] as Stroke[] };
    const updated = [...pages, newPg]; setPages(updated);
    const ni = updated.length - 1; setPageIdx(ni);
    strokesRef.current = []; baseImageRef.current = null;
    redrawBase(); clearActive();
  };

  const bgColor = paperType==='black'?'#1a1a1a':paperType==='yellow'?'#fef9c3':'#ffffff';
  const isHL = penType === 'highlighter';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col h-dvh overflow-hidden" style={{paddingBottom:'env(safe-area-inset-bottom,0)'}}>

      {/* ── Toolbar ── */}
      {/* touch-action:auto so stylus can tap inputs on tablet */}
      <div className="bg-stone-100 dark:bg-slate-800 px-2 py-1.5 border-b border-stone-200 dark:border-slate-700 shadow-sm relative z-30 space-y-1.5"
        style={{touchAction:'auto'}}>

        {/* Row 1: back / title / page nav / collapse / save */}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onBack}
            className="px-2 py-1 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-lg font-black text-xs flex items-center gap-1 text-stone-700 dark:text-slate-200 cursor-pointer hover:bg-purple-50">
            <ChevronLeft className="w-3.5 h-3.5 text-purple-600"/>
            <span className="hidden sm:inline">목록</span>
          </button>

          {/* Title — explicit pointer-events + stop propagation so stylus works */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="제목 (선택사항)"
            inputMode="text"
            className="flex-1 min-w-0 text-sm font-bold bg-transparent outline-none text-stone-800 dark:text-slate-100 placeholder-stone-300 dark:placeholder-slate-600 px-1 py-1"
            style={{touchAction:'auto', pointerEvents:'auto'}}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          />

          {/* Page nav */}
          <div className="flex items-center bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl px-1.5 py-1 gap-1 shadow-sm"
            style={{touchAction:'auto'}}>
            <button type="button" disabled={pageIdx===0} onClick={() => goToPage(pageIdx-1)}
              className="p-0.5 disabled:opacity-30 hover:bg-stone-100 rounded cursor-pointer">
              <ChevronLeft className="w-3.5 h-3.5 text-purple-600"/>
            </button>
            <span className="text-[11px] font-black text-stone-700 dark:text-slate-200">{pageIdx+1}/{pages.length}</span>
            <button type="button" onClick={() => pageIdx<pages.length-1?goToPage(pageIdx+1):addPage()}
              className="p-0.5 hover:bg-stone-100 rounded cursor-pointer">
              <ChevronRight className="w-3.5 h-3.5 text-purple-600"/>
            </button>
          </div>

          <button type="button" onClick={() => setToolbarCollapsed(!toolbarCollapsed)}
            className="sm:hidden flex items-center gap-1 px-2 py-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-black cursor-pointer text-stone-700">
            {toolbarCollapsed ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronUp className="w-3.5 h-3.5"/>}
          </button>

          <button type="button" onClick={handleSave}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1 shadow-md cursor-pointer active:scale-95">
            <Check className="w-4 h-4"/><span>저장</span>
          </button>
        </div>

        {/* Row 2: pen tools */}
        <div className={`${toolbarCollapsed?'hidden':'flex'} sm:flex items-center gap-1.5 flex-wrap`}>

          {/* ── Pen type selector ── */}
          <div className="relative">
            <button type="button"
              onClick={() => { setShowPenMenu(!showPenMenu); setShowColorPicker(false); setShowSizePicker(false); setShowEraserMenu(false); setShowPaperMenu(false); }}
              className={`border font-extrabold text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm ${isEraser?'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-200':'bg-purple-600 border-purple-700 text-white'}`}>
              <span>{PEN_ICONS[penType]}</span>
              <span className="hidden sm:inline">{PEN_LABELS[penType]}</span>
              <span className="text-[10px] opacity-70">▼</span>
            </button>
            {showPenMenu && (
              <div ref={penMenuRef} className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl p-1.5 shadow-xl z-50 min-w-[160px] flex flex-col gap-1">
                {(['pen','fountain','highlighter'] as PenType[]).map(pt => (
                  <button key={pt} type="button"
                    onClick={() => { setPenType(pt); setIsEraser(false); setShowPenMenu(false); }}
                    className={`px-3 py-2 rounded-xl text-xs font-black text-left flex items-center gap-2 cursor-pointer ${penType===pt&&!isEraser?'bg-purple-600 text-white':'text-stone-800 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'}`}>
                    <span>{PEN_ICONS[pt]}</span><span>{PEN_LABELS[pt]}</span>
                  </button>
                ))}
                {/* Fountain pen intensity */}
                {penType === 'fountain' && (
                  <div className="px-3 py-2 border-t border-stone-100 dark:border-slate-700 mt-1">
                    <div className="text-[10px] font-black text-stone-500 mb-1.5">만년필 필압 강도</div>
                    <div className="flex gap-1">
                      {[{label:'약',val:0.7},{label:'중',val:1.2},{label:'강',val:2.0}].map(({label,val}) => (
                        <button key={label} type="button"
                          onClick={() => setFountainIntensity(val)}
                          className={`flex-1 py-1 rounded-lg text-[10px] font-black cursor-pointer ${fountainIntensity===val?'bg-purple-600 text-white':'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Color picker ── */}
          <div className="relative">
            <button type="button"
              onClick={() => { setShowColorPicker(!showColorPicker); setShowSizePicker(false); setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false); }}
              className="bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 font-extrabold text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm hover:bg-stone-50 text-stone-800 dark:text-slate-200">
              <span className="w-3.5 h-3.5 rounded-full border border-stone-300 shrink-0"
                style={{backgroundColor: isEraser ? '#9ca3af' : penColor, opacity: isHL ? 0.5 : 1}}/>
              <span className="hidden sm:inline text-[11px]">색상</span>
              <span className="text-[10px] text-stone-400">▼</span>
            </button>
            {showColorPicker && (
              <div ref={colorPickerRef} className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl p-2.5 shadow-xl z-50" style={{minWidth:200}}>
                <div className="grid grid-cols-4 gap-1.5">
                  {(isHL ? HL_COLORS : COLOR_PALETTE).map(c => (
                    <button key={c} type="button"
                      onClick={() => { setPenColor(c); setIsEraser(false); setShowColorPicker(false); }}
                      className={`w-8 h-8 rounded-full border-2 cursor-pointer ${!isEraser&&penColor===c?'ring-2 ring-purple-500 ring-offset-1 border-purple-400 scale-110':'border-stone-300 dark:border-slate-600 hover:scale-105'}`}
                      style={{backgroundColor:c, opacity: isHL ? 0.6 : 1}}/>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-stone-100 dark:border-slate-700">
                  <input type="color" value={penColor} onChange={e => { setPenColor(e.target.value); setIsEraser(false); }}
                    className="w-7 h-7 rounded cursor-pointer border border-stone-200"/>
                  <span className="text-[10px] font-mono text-stone-500">{penColor}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Size picker ── */}
          <div className="relative">
            <button type="button"
              onClick={() => { setShowSizePicker(!showSizePicker); setShowColorPicker(false); setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false); }}
              className="bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 font-extrabold text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm hover:bg-stone-50 text-stone-800 dark:text-slate-200">
              <span className="flex items-center justify-center w-5 h-5">
                <span className="rounded-full bg-current" style={{width:Math.max(3,Math.min(14,penSize))+'px',height:Math.max(3,Math.min(14,penSize))+'px'}}/>
              </span>
              <span className="text-[11px]">{penSize.toFixed(1)}px</span>
              <span className="text-[10px] text-stone-400">▼</span>
            </button>
            {showSizePicker && (
              <div ref={sizePickerRef} className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl p-3 shadow-xl z-50" style={{minWidth:220}}>
                {/* 직접 입력 + 슬라이더 */}
                <div className="mb-3">
                  {/* 숫자 직접 입력 */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] text-stone-500 dark:text-slate-400 shrink-0 font-bold">굵기</span>
                    <div className="flex items-center flex-1 bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-300 dark:border-purple-700 rounded-xl overflow-hidden">
                      {/* − 버튼 */}
                      <button type="button"
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation();
                          const next = Math.max(0.1, Math.round((penSize - 0.1) * 10) / 10);
                          setPenSize(next); setPenSizeInput(next.toFixed(1));
                        }}
                        className="px-3 py-2 text-purple-600 font-black text-lg hover:bg-purple-100 dark:hover:bg-purple-900/40 cursor-pointer select-none">−</button>
                      {/* 텍스트 입력 */}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={penSizeInput}
                        onChange={e => setPenSizeInput(e.target.value)}
                        onFocus={e => { e.stopPropagation(); e.target.select(); }}
                        onBlur={e => {
                          const v = parseFloat(penSizeInput);
                          if (!isNaN(v) && v > 0) {
                            const clamped = Math.min(20, Math.max(0.1, Math.round(v * 10) / 10));
                            setPenSize(clamped); setPenSizeInput(clamped.toFixed(1));
                          } else {
                            setPenSizeInput(penSize.toFixed(1));
                          }
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const v = parseFloat(penSizeInput);
                            if (!isNaN(v) && v > 0) {
                              const clamped = Math.min(20, Math.max(0.1, Math.round(v * 10) / 10));
                              setPenSize(clamped); setPenSizeInput(clamped.toFixed(1));
                            } else {
                              setPenSizeInput(penSize.toFixed(1));
                            }
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                        style={{ touchAction: 'auto' }}
                        className="flex-1 text-center font-black text-base text-purple-700 dark:text-purple-200 bg-transparent outline-none py-2 min-w-0"
                      />
                      {/* + 버튼 */}
                      <button type="button"
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation();
                          const next = Math.min(20, Math.round((penSize + 0.1) * 10) / 10);
                          setPenSize(next); setPenSizeInput(next.toFixed(1));
                        }}
                        className="px-3 py-2 text-purple-600 font-black text-lg hover:bg-purple-100 dark:hover:bg-purple-900/40 cursor-pointer select-none">+</button>
                    </div>
                    <span className="text-[10px] text-stone-400 shrink-0">px</span>
                    {/* 미리보기 */}
                    <span className="w-8 flex items-center justify-center shrink-0">
                      <span className="rounded-full bg-stone-800 dark:bg-white inline-block"
                        style={{width:Math.max(2,Math.min(16,penSize))+'px', height:Math.max(2,Math.min(16,penSize))+'px'}}/>
                    </span>
                  </div>
                  {/* 슬라이더 */}
                  <div className="flex justify-between text-[10px] text-stone-400 mb-1">
                    <span>0.1</span><span>20px</span>
                  </div>
                  <input type="range" min="0.1" max="20" step="0.1" value={penSize}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      setPenSize(v); setPenSizeInput(v.toFixed(1));
                    }}
                    className="w-full accent-purple-600 cursor-pointer"/>
                </div>
                {/* Quick presets */}
                <div className="grid grid-cols-4 gap-1">
                  {QUICK_SIZES.map(s => (
                    <button key={s} type="button"
                      onClick={() => { setPenSize(s); setPenSizeInput(s.toFixed(1)); setShowSizePicker(false); }}
                      className={`py-1.5 rounded-xl text-[10px] font-black flex flex-col items-center gap-0.5 cursor-pointer ${penSize===s?'bg-purple-600 text-white':'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200'}`}>
                      <span className="rounded-full bg-current" style={{width:Math.max(2,Math.min(12,s))+'px',height:Math.max(2,Math.min(12,s))+'px'}}/>
                      <span>{s}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Eraser ── */}
          <div className="relative flex items-center">
            <div className={`flex items-center rounded-xl border overflow-hidden shadow-sm ${isEraser?'bg-purple-600 text-white border-purple-700':'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-800 dark:text-slate-200'}`}>
              <button type="button" onClick={() => { setIsEraser(!isEraser); setShowEraserMenu(false); }}
                className="px-2.5 py-1.5 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95">
                <Eraser className="w-3.5 h-3.5"/>
                <span>{isEraser?(eraserType==='stroke'?'획지우개':'부분지우개'):'지우개'}</span>
              </button>
              <button type="button"
                onClick={() => { setShowEraserMenu(!showEraserMenu); setShowColorPicker(false); setShowSizePicker(false); setShowPenMenu(false); setShowPaperMenu(false); }}
                className={`px-1.5 py-1.5 border-l text-[10px] cursor-pointer hover:bg-black/10 ${isEraser?'border-purple-500':'border-stone-200 dark:border-slate-700 text-stone-500'}`}>▼</button>
            </div>
            {showEraserMenu && (
              <div ref={eraserMenuRef} className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl p-1.5 shadow-xl z-50 min-w-[180px] flex flex-col gap-1">
                <button type="button" onClick={() => { setIsEraser(true); setEraserType('stroke'); setShowEraserMenu(false); }}
                  className={`px-3 py-2 rounded-xl text-xs font-black text-left flex items-center gap-2 cursor-pointer ${isEraser&&eraserType==='stroke'?'bg-purple-600 text-white':'text-stone-800 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'}`}>
                  <Eraser className="w-3.5 h-3.5"/><span>획지우개</span>
                </button>
                <button type="button" onClick={() => { setIsEraser(true); setEraserType('area'); setShowEraserMenu(false); }}
                  className={`px-3 py-2 rounded-xl text-xs font-black text-left flex items-center gap-2 cursor-pointer ${isEraser&&eraserType==='area'?'bg-purple-600 text-white':'text-stone-800 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'}`}>
                  <Eraser className="w-3.5 h-3.5"/><span>부분지우개</span>
                </button>
                <div className="h-px bg-stone-100 dark:bg-slate-700 my-0.5"/>
                <button type="button" onClick={() => setAutoReturnPen(!autoReturnPen)}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-left flex items-center justify-between text-stone-700 dark:text-slate-300 hover:bg-stone-100 cursor-pointer">
                  <span>지우개 후 펜 복귀</span>
                  <span className={`font-black ${autoReturnPen?'text-purple-600':'text-stone-400'}`}>{autoReturnPen?'ON':'OFF'}</span>
                </button>
                <button type="button" onClick={() => { clearCanvas(); setShowEraserMenu(false); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-black text-left text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5"/><span>전체 지우기</span>
                </button>
              </div>
            )}
          </div>

          {/* ── Paper ── */}
          <div className="relative">
            <button type="button"
              onClick={() => { setShowPaperMenu(!showPaperMenu); setShowColorPicker(false); setShowSizePicker(false); setShowPenMenu(false); setShowEraserMenu(false); }}
              className="bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 font-extrabold text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm hover:bg-stone-50 text-stone-800 dark:text-slate-200">
              <span>{paperType==='black'?'🖤':paperType==='yellow'?'📒':'📄'}</span>
              <span className="hidden sm:inline text-[11px]">종이</span>
              <span className="text-[10px] text-stone-400">▼</span>
            </button>
            {showPaperMenu && (
              <div ref={paperMenuRef} className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl p-2 shadow-xl z-50 min-w-[180px] flex flex-col gap-1.5">
                <div className="flex gap-1.5">
                  {(['white','yellow','black'] as const).map(pt => (
                    <button key={pt} type="button" onClick={() => {
                      setPaperType(pt); live.current.paperType = pt;
                      if (pt==='black'&&penColor==='#1c1917') setPenColor('#ffffff');
                      if (pt!=='black'&&penColor==='#ffffff') setPenColor('#1c1917');
                    }}
                      className={`flex-1 py-2 rounded-xl text-xs font-black border-2 cursor-pointer ${paperType===pt?'border-purple-500 ring-2 ring-purple-200':'border-stone-200 dark:border-slate-600'}`}
                      style={{backgroundColor:pt==='black'?'#1a1a1a':pt==='yellow'?'#fef9c3':'#ffffff',color:pt==='black'?'#fff':'#333'}}>
                      {pt==='white'?'흰색':pt==='yellow'?'노랑':'검정'}
                    </button>
                  ))}
                </div>
                <div className="h-px bg-stone-100 dark:bg-slate-700"/>
                <button type="button" onClick={() => setShowLines(!showLines)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black text-left flex items-center justify-between text-stone-700 dark:text-slate-300 hover:bg-stone-100 cursor-pointer">
                  <span>줄 표시</span>
                  <span className={`font-black ${showLines?'text-purple-600':'text-stone-400'}`}>{showLines?'ON':'OFF'}</span>
                </button>
                {showLines && (
                  <div className="flex gap-1 px-1">
                    {[24,30,36,44].map(sp => (
                      <button key={sp} type="button" onClick={() => setLineSpacing(sp)}
                        className={`flex-1 py-1 rounded-lg text-[10px] font-black cursor-pointer ${lineSpacing===sp?'bg-purple-600 text-white':'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
                        {sp}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Palm rejection ── */}
          <button type="button" onClick={() => setPenOnlyMode(!penOnlyMode)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-black border cursor-pointer ${penOnlyMode?'bg-purple-100 dark:bg-purple-950/60 border-purple-300 text-purple-900 ring-2 ring-purple-200/80':'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-300'}`}>
            <Hand className="w-3.5 h-3.5 text-purple-600"/>
            <span className="hidden sm:inline">{penOnlyMode?'펜전용':'터치/펜'}</span>
          </button>

          {/* ── OCR ── */}
          <button type="button" disabled={isOcrLoading} onClick={() => handleOcr()}
            className={`font-extrabold text-xs px-2.5 py-1.5 rounded-xl flex items-center gap-1 cursor-pointer shadow-sm active:scale-95 disabled:opacity-50 text-white shrink-0 ${isOcrLoading?'bg-purple-500':ocrText?'bg-blue-500 hover:bg-blue-600':'bg-red-500 hover:bg-red-600 animate-pulse'}`}>
            <Sparkles className="w-3.5 h-3.5"/>
            <span>{isOcrLoading?'판독중':ocrText?'AI완료':'AI인식'}</span>
          </button>
        </div>
      </div>

      {/* OCR message */}
      {ocrMsg && (
        <div className="px-3 py-1.5 bg-purple-50 dark:bg-purple-950/40 border-b border-purple-200 text-xs font-bold text-purple-900 dark:text-purple-200 flex items-center justify-between gap-2">
          <span className="truncate">{ocrMsg}</span>
          <button type="button" onClick={() => setOcrMsg(null)} className="text-purple-400 hover:text-purple-700 font-black cursor-pointer shrink-0">✕</button>
        </div>
      )}

      {/* ── Canvas ── */}
      <div ref={containerRef} className="relative w-full flex-1 overflow-hidden select-none"
        style={{touchAction:'none', overscrollBehavior:'none', backgroundColor:bgColor}}>
        <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full block"
          style={{touchAction:'none', userSelect:'none', willChange:'transform'}}/>
        <canvas ref={activeCanvasRef} className="absolute inset-0 w-full h-full block"
          style={{touchAction:'none', userSelect:'none', willChange:'transform', background:'transparent'}}/>
      </div>

      {/* OCR result */}
      {ocrText && (
        <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200 font-medium line-clamp-2">
          ✍️ {ocrText}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-stone-400 dark:text-slate-500 font-bold px-2 py-1 bg-stone-50 dark:bg-slate-900 border-t border-stone-200 dark:border-slate-800">
        <span className="hidden sm:inline">💡 {PEN_ICONS[penType]} {PEN_LABELS[penType]} {penSize}px | 저장 시 AI 자동 인식</span>
        <span className="sm:hidden">💡 저장 시 AI 자동 인식</span>
        <span>페이지 {pageIdx+1}/{pages.length}</span>
      </div>
    </div>
  );
};
