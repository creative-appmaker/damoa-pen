import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Eraser, Trash2, Check, Sparkles,
  Hand, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  FileText, FolderOpen, Tag, Lock, Unlock, Settings, X, Plus,
} from 'lucide-react';
import { PenNote, Folder, PenType, StrokePoint, SavedStroke, PenSettings } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────
type Point = StrokePoint; // StrokePoint와 동일, 로컬 별칭

interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  penType: PenType;
  fountainIntensity: number;
}

interface Props {
  editingNote: PenNote | null;
  darkMode: boolean;
  folders?: Folder[];
  onSave: (
    dataUrl: string, ocrText: string, title: string,
    paperType: 'white'|'yellow'|'black',
    tags: string[], folderId?: string,
    pdfBase64?: string, pdfText?: string, pdfPageCount?: number,
    pageStrokes?: SavedStroke[][],
    penSettings?: PenSettings,
    pageImages?: (string|undefined)[],
    id?: string,
  ) => void;
  onBack: () => void;
  // Tab system
  openTabs?: Array<{ noteId: string | null; title: string; color: string }>;
  activeTabIdx?: number;
  onTabSwitch?: (newIdx: number) => void;
  onTabClose?: (idx: number) => void;
  onTabColorCycle?: (idx: number) => void;
  onNewTab?: () => void;
}

// 페이지 데이터 (bgImageUrl 제거 — PDF는 pdfDocRef + 메모리 캐시로 처리)
interface Page { id: string; strokes: Stroke[]; }

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
export const PenCanvas: React.FC<Props> = ({
  editingNote, darkMode, folders = [], onSave, onBack,
  openTabs, activeTabIdx: activeTabIdxProp = 0,
  onTabSwitch, onTabClose, onTabColorCycle, onNewTab,
}) => {
  const baseCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef    = useRef<HTMLDivElement | null>(null);
  const isDrawingRef    = useRef(false);
  const currentStrokeRef= useRef<Stroke | null>(null);
  const strokesRef      = useRef<Stroke[]>([]);
  const baseImageRef    = useRef<HTMLImageElement | null>(null);
  const pageBgImageRef  = useRef<HTMLImageElement | null>(null); // 현재 페이지 PDF 렌더 캐시
  const cachedRectRef   = useRef<DOMRect | null>(null);
  const rafPendingRef   = useRef(false);
  const pdfInputRef     = useRef<HTMLInputElement | null>(null);
  const imgInputRef     = useRef<HTMLInputElement | null>(null); // 사진 첨부 input
  const pdfDocRef       = useRef<any>(null);               // pdf.js PDFDocumentProxy
  const pdfCacheRef     = useRef<Map<number, string>>(new Map()); // 인메모리 JPEG 캐시 (pageIdx → dataUrl)
  const pageUserImgRef  = useRef<HTMLImageElement | null>(null);  // 현재 페이지 첨부 사진
  const pageImagesRef   = useRef<(string|undefined)[]>([]); // 전체 페이지 첨부 사진 배열 (ref → stale 방지)

  const initPT = editingNote?.paperType ?? (darkMode ? 'black' : 'white');
  const initPS = editingNote?.penSettings;

  const [title,             setTitle]             = useState(editingNote?.title ?? '');
  const [paperType,         setPaperType]         = useState<'white'|'yellow'|'black'>(initPT);
  const [penColor,          setPenColor]          = useState(initPS?.penColor ?? (initPT === 'black' ? '#ffffff' : '#1c1917'));
  const [penSize,           setPenSize]           = useState(initPS?.penSize ?? 2);
  const [penSizeInput,      setPenSizeInput]      = useState((initPS?.penSize ?? 2).toFixed(1)); // 직접 입력용 문자열
  const [penType,           setPenType]           = useState<PenType>(editingNote?.penSettings?.penType ?? 'fountain');
  const [fountainIntensity, setFountainIntensity] = useState(editingNote?.penSettings?.fountainIntensity ?? 1.0);
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
  const [pages,        setPages]        = useState<Page[]>([{ id: 'p1', strokes: [] }]);
  const [pageIdx,      setPageIdx]      = useState(0);
  const [swipeHint,    setSwipeHint]    = useState<'idle'|'hinting'>('idle');
  const [swipeProgress,setSwipeProgress]= useState(0); // 0~1
  const [tags,          setTags]         = useState<string[]>(editingNote?.tags ?? []);
  const [tagsInput,     setTagsInput]    = useState((editingNote?.tags ?? []).join(', '));
  const [noteFolderId,  setNoteFolderId] = useState<string | undefined>(editingNote?.folderId);
  const [showNoteInfo,  setShowNoteInfo] = useState(false);
  const [loadingPdf,    setLoadingPdf]   = useState(false);
  const [pdfBase64,     setPdfBase64]    = useState<string | undefined>(editingNote?.pdfBase64);
  const [pdfText,       setPdfText]      = useState<string | undefined>(editingNote?.pdfText);
  const [pdfPageCount,  setPdfPageCount] = useState<number | undefined>(editingNote?.pdfPageCount);
  const [pdfRenderMsg,  setPdfRenderMsg] = useState<string | null>(null); // "3/40페이지 렌더링 중..."
  const [pageImages,    setPageImages]   = useState<(string|undefined)[]>(editingNote?.pageImages ?? []);

  const swipeTouchRef  = useRef<{ id: number; startX: number; startY: number; startTime: number; classified: boolean; isSwipe: boolean } | null>(null);
  const addPageRef     = useRef<() => void>(() => {});
  const goToPageRef    = useRef<(idx: number) => void>(() => {});
  const pagesLenRef    = useRef<number>(1);
  const canvasWrapRef  = useRef<HTMLDivElement | null>(null);
  const pinchRef       = useRef<{ t1Id: number; t2Id: number; startDist: number; startScale: number; midCanvasX: number; midCanvasY: number } | null>(null);
  const canvasXformRef = useRef({ scale: 1, x: 0, y: 0 });

  const [zoomEnabled,      setZoomEnabled]      = useState(false);
  const [zoomLocked,       setZoomLocked]       = useState(false);
  const [showSettingsPanel,setShowSettingsPanel] = useState(false);
  const [canvasXform, setCanvasXform] = useState({ scale: 1, x: 0, y: 0 });

  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const sizePickerRef  = useRef<HTMLDivElement | null>(null);
  const penMenuRef     = useRef<HTMLDivElement | null>(null);
  const eraserMenuRef  = useRef<HTMLDivElement | null>(null);
  const paperMenuRef   = useRef<HTMLDivElement | null>(null);

  const live = useRef({
    penOnlyMode: true,
    penColor: initPS?.penColor ?? (initPT === 'black' ? '#ffffff' : '#1c1917'),
    penSize: initPS?.penSize ?? 2, penType: (initPS?.penType ?? 'fountain') as PenType, fountainIntensity: initPS?.fountainIntensity ?? 1.0,
    isEraser: false, eraserType: 'stroke' as 'stroke'|'area',
    pageIdx: 0, autoReturnPen: true,
    paperType: initPT as 'white'|'yellow'|'black', showLines: true, lineSpacing: 30,
    zoomEnabled: false,
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
  live.current.zoomEnabled        = zoomEnabled;
  pageImagesRef.current           = pageImages; // stale closure 방지용 ref 동기화

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
    const dpr  = Math.min(window.devicePixelRatio || 1, 2); // 2 초과 DPR 제한 → 대형 태블릿 빈 캔버스 방지
    const cssW = canvas.width / dpr, cssH = canvas.height / dpr;
    const ctx  = canvas.getContext('2d')!;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    drawBackground(ctx, cssW, cssH);
    // 첨부 사진 레이어 (종이색 위, PDF/스트로크 아래) — contain 방식
    if (pageUserImgRef.current) {
      const img = pageUserImgRef.current;
      const scale = Math.min(cssW / img.naturalWidth, cssH / img.naturalHeight);
      const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
      const ix = (cssW - iw) / 2, iy = (cssH - ih) / 2;
      ctx.globalAlpha = 1;
      ctx.drawImage(img, ix, iy, iw, ih);
    }
    // PDF 페이지 배경 (종이색 위, 스트로크 아래)
    if (pageBgImageRef.current) {
      ctx.globalAlpha = 1;
      ctx.drawImage(pageBgImageRef.current, 0, 0, cssW, cssH);
    }
    if (baseImageRef.current) ctx.drawImage(baseImageRef.current, 0, 0, cssW, cssH);
    strokesRef.current.forEach(s => drawStroke(s, ctx));
  }, [drawBackground]);

  const clearActive = useCallback(() => {
    const ac = activeCanvasRef.current;
    if (!ac) return;
    const ctx = ac.getContext('2d')!;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0, 0, ac.width, ac.height); ctx.restore();
  }, []);

  // Export for saving — CSS 픽셀 크기로 내보내 대형 기기에서의 빈 캔버스 문제 방지
  const getExportDataUrl = (): string => {
    try {
      const base = baseCanvasRef.current;
      if (!base) return '';
      const dpr = window.devicePixelRatio || 1;
      // CSS 픽셀 크기 (물리 픽셀 아님) → 대형 태블릿에서 메모리 초과 방지
      const cssW = Math.round(base.width  / dpr);
      const cssH = Math.round(base.height / dpr);
      if (cssW < 10 || cssH < 10) return '';
      const tmp = document.createElement('canvas');
      tmp.width  = cssW;
      tmp.height = cssH;
      const ctx = tmp.getContext('2d')!;
      // 흰색 배경 보장
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.drawImage(base,   0, 0, base.width,   base.height,   0, 0, cssW, cssH);
      const active = activeCanvasRef.current;
      if (active) ctx.drawImage(active, 0, 0, active.width, active.height, 0, 0, cssW, cssH);
      // PNG 대신 JPEG — 파일 크기 작고 toDataURL 실패율 낮음
      const url = tmp.toDataURL('image/jpeg', 0.88);
      if (!url || url.length < 200 || !url.startsWith('data:image')) {
        console.error('[damoa-pen] getExportDataUrl: 빈 이미지 반환됨');
        return '';
      }
      return url;
    } catch (e) {
      console.error('[damoa-pen] getExportDataUrl 실패:', e);
      return '';
    }
  };

  // ── Canvas init ─────────────────────────────────────────────────────────
  const initCanvas = useCallback(() => {
    const base = baseCanvasRef.current, active = activeCanvasRef.current;
    if (!base || !active) return;
    const container = containerRef.current;
    const w = container?.clientWidth || 800, h = container?.clientHeight || 520;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 최대 2x — Lenovo Y700 빈 캔버스 방지
    [base, active].forEach(c => {
      c.width = w * dpr; c.height = h * dpr;
      c.style.width = `${w}px`; c.style.height = `${h}px`;
      const ctx = (c.getContext('2d', { desynchronized: true }) || c.getContext('2d')) as CanvasRenderingContext2D;
      ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    });
    cachedRectRef.current = base.getBoundingClientRect();
    redrawBase();
  }, [redrawBase]);

  // ── PDF 헬퍼 ──────────────────────────────────────────────────────────────
  /** 페이지 인덱스(0-based)를 JPEG dataUrl로 렌더. 메모리 캐시 우선. */
  const renderPdfPage = useCallback(async (idx: number): Promise<string | null> => {
    // 1. 메모리 캐시 확인
    const hit = pdfCacheRef.current.get(idx);
    if (hit) return hit;
    // 2. pdf.js 렌더
    if (!pdfDocRef.current) return null;
    try {
      const page = await pdfDocRef.current.getPage(idx + 1);
      const container = containerRef.current;
      const cssW = container?.clientWidth  || 800;
      const cssH = container?.clientHeight || 600;
      const vp0  = page.getViewport({ scale: 1 });
      const scale = Math.min(cssW / vp0.width, cssH / vp0.height) * 1.5;
      const vp = page.getViewport({ scale });
      const c  = document.createElement('canvas');
      c.width  = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpeg = c.toDataURL('image/jpeg', 0.88);
      pdfCacheRef.current.set(idx, jpeg);
      return jpeg;
    } catch (e) {
      console.error(`[damoa-pen] PDF 페이지 ${idx+1} 렌더 실패:`, e);
      return null;
    }
  }, []); // 의존성 없음 — ref만 사용

  /** 페이지 idx를 렌더해서 캔버스 배경으로 표시 */
  const loadPageBg = useCallback(async (idx: number) => {
    const jpeg = await renderPdfPage(idx);
    if (!jpeg) { pageBgImageRef.current = null; redrawBase(); return; }
    const img = new Image();
    img.onload = () => { pageBgImageRef.current = img; redrawBase(); };
    img.src = jpeg;
  }, [renderPdfPage, redrawBase]);

  // ── pdf.js 초기화 헬퍼 ─────────────────────────────────────────────────
  const initPdfJs = () => {
    const lib = (window as any).pdfjsLib;
    if (!lib) return null;
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return lib;
  };

  // ── Load editing note ───────────────────────────────────────────────────
  useEffect(() => {
    // PDF/캐시 초기화
    pdfDocRef.current = null;
    pdfCacheRef.current.clear();
    pageBgImageRef.current = null;

    if (editingNote?.pdfBase64) {
      // ── PDF 노트 복원 ──
      const count = editingNote.pdfPageCount ?? 1;
      setPdfBase64(editingNote.pdfBase64);
      setPdfText(editingNote.pdfText);
      setPdfPageCount(count);

      // 페이지 구조 + 손글씨 복원
      const restored: Page[] = Array.from({ length: count }, (_, i) => ({
        id: `p-pdf-${i+1}`,
        strokes: (editingNote.pageStrokes?.[i] ?? []) as Stroke[],
      }));
      setPages(restored);
      setPageIdx(0);
      strokesRef.current = restored[0]?.strokes ?? [];
      baseImageRef.current = null;

      // pdf.js로 로드 후 1페이지 즉시 렌더, 나머지 백그라운드
      const pdfjsLib = initPdfJs();
      if (pdfjsLib) {
        const binary = atob(editingNote.pdfBase64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        pdfjsLib.getDocument({ data: bytes.buffer }).promise
          .then(async (pdf: any) => {
            pdfDocRef.current = pdf;
            await loadPageBg(0);
            // 백그라운드: 나머지 페이지 렌더
            for (let i = 1; i < count; i++) {
              setPdfRenderMsg(`PDF 백그라운드 렌더 ${i+1}/${count}...`);
              await renderPdfPage(i);
            }
            setPdfRenderMsg(null);
          })
          .catch((e: Error) => console.error('[damoa-pen] PDF 로드 실패:', e));
      }
    } else {
      // ── 일반 손글씨 노트 ──
      setPdfBase64(undefined); setPdfText(undefined); setPdfPageCount(undefined);
      setPages([{ id: 'p1', strokes: [] }]);
      setPageIdx(0);

      if (editingNote?.dataUrl) {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { baseImageRef.current = img; redrawBase(); };
        img.src = editingNote.dataUrl;
      } else {
        baseImageRef.current = null; strokesRef.current = [];
      }
    }

    // 공통 메타 복원
    setOcrText(editingNote?.ocrText ?? '');
    setTitle(editingNote?.title ?? '');
    setTags(editingNote?.tags ?? []);
    setTagsInput((editingNote?.tags ?? []).join(', '));
    setNoteFolderId(editingNote?.folderId);
    const pt = editingNote?.paperType ?? (darkMode ? 'black' : 'white');
    setPaperType(pt);
    live.current.paperType = pt;

    // 펜 설정 복원 (저장된 설정 우선, 없으면 기본값)
    const ps = editingNote?.penSettings;
    const defaultColor = pt === 'black' ? '#ffffff' : '#1c1917';
    setPenColor(ps?.penColor ?? defaultColor);
    setPenSize(ps?.penSize ?? 2);
    setPenSizeInput((ps?.penSize ?? 2).toFixed(1));
    setPenType(ps?.penType ?? 'fountain');
    setFountainIntensity(ps?.fountainIntensity ?? 1.0);
    live.current.penColor          = ps?.penColor ?? defaultColor;
    live.current.penSize           = ps?.penSize ?? 2;
    live.current.penType           = ps?.penType ?? 'fountain';
    live.current.fountainIntensity = ps?.fountainIntensity ?? 1.0;

    // 첨부 사진 복원
    const imgs = editingNote?.pageImages ?? [];
    setPageImages(imgs);
    pageImagesRef.current = imgs;
    // 0번 페이지 사진 로드
    pageUserImgRef.current = null;
    if (imgs[0]) {
      const ui = new Image();
      ui.onload = () => { pageUserImgRef.current = ui; redrawBase(); };
      ui.src = imgs[0];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNote, darkMode]);

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

  // ── Palm rejection + 스와이프 새 페이지 ─────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ① 컨테이너 수준에서 터치 분류: 스와이프 vs 팜 vs 핀치 줌
    const onTouchStart = (e: TouchEvent) => {
      // 2-finger + zoomEnabled → 핀치 줌 시작
      if (e.touches.length === 2 && live.current.zoomEnabled) {
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const containerRect = containerRef.current!.getBoundingClientRect();
        const midSx = (t1.clientX + t2.clientX) / 2 - containerRect.left;
        const midSy = (t1.clientY + t2.clientY) / 2 - containerRect.top;
        const { scale, x: offX, y: offY } = canvasXformRef.current;
        pinchRef.current = {
          t1Id: t1.identifier, t2Id: t2.identifier,
          startDist: dist, startScale: scale,
          midCanvasX: (midSx - offX) / scale,
          midCanvasY: (midSy - offY) / scale,
        };
        swipeTouchRef.current = null;
        return;
      }
      // 2+ 터치인데 줌 비활성 → 핀치 취소, 스와이프 취소
      if (e.touches.length !== 1) {
        swipeTouchRef.current = null;
        pinchRef.current = null;
        return;
      }
      // 1-finger → 스와이프/팜 분류
      pinchRef.current = null;
      const t = e.touches[0];
      swipeTouchRef.current = {
        id: t.identifier, startX: t.clientX, startY: t.clientY,
        startTime: Date.now(), classified: false, isSwipe: false,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      // 핀치 줌 처리 (2-finger)
      const pr = pinchRef.current;
      if (pr && e.touches.length >= 2) {
        const t1 = Array.from(e.touches).find(t => t.identifier === pr.t1Id);
        const t2 = Array.from(e.touches).find(t => t.identifier === pr.t2Id);
        if (t1 && t2) {
          const dist    = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          const rawScale = pr.startScale * dist / pr.startDist;
          const newScale = Math.max(0.3, Math.min(8, rawScale)); // 0.3x ~ 8x
          const containerRect = containerRef.current!.getBoundingClientRect();
          const newMidSx = (t1.clientX + t2.clientX) / 2 - containerRect.left;
          const newMidSy = (t1.clientY + t2.clientY) / 2 - containerRect.top;
          // 중심점(canvas 좌표)이 화면 상 같은 위치에 유지되도록 offset 계산
          const newX = newMidSx - pr.midCanvasX * newScale;
          const newY = newMidSy - pr.midCanvasY * newScale;
          const xform = { scale: newScale, x: newX, y: newY };
          canvasXformRef.current = xform;
          setCanvasXform(xform);
          cachedRectRef.current = null; // 시각적 rect 변경 → 캐시 무효화
        }
        e.preventDefault();
        return;
      }

      const sr = swipeTouchRef.current;
      if (!sr) return;
      const touch = Array.from(e.touches).find(t => t.identifier === sr.id);
      if (!touch) return;

      const dx = touch.clientX - sr.startX;
      const dy = touch.clientY - sr.startY;

      if (!sr.classified && (Math.abs(dx) > 14 || Math.abs(dy) > 14)) {
        // 수평 지배면 스와이프 (좌우 양방향)
        sr.isSwipe = Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 10;
        sr.classified = true;
      }

      if (sr.classified && sr.isSwipe) {
        e.preventDefault(); // 스크롤 방지
        // 왼쪽 스와이프 + 느린 경우(400ms 초과)만 힌트 표시 → 새 페이지 예정
        if (dx < 0) {
          const elapsed = Date.now() - sr.startTime;
          if (elapsed > 350) {
            const prog = Math.min(1, Math.abs(dx) / 120);
            setSwipeProgress(prog);
            setSwipeHint('hinting');
          }
        }
      } else if (live.current.penOnlyMode) {
        // 팜리젝션: 스와이프가 아닌 터치 차단
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // 핀치 손가락 떼기
      if (pinchRef.current) {
        const pr = pinchRef.current;
        const remaining = Array.from(e.touches);
        if (!remaining.find(t => t.identifier === pr.t1Id) || !remaining.find(t => t.identifier === pr.t2Id)) {
          pinchRef.current = null;
        }
        return;
      }

      const sr = swipeTouchRef.current;
      if (!sr) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === sr.id);
      if (touch && sr.isSwipe) {
        const dx = touch.clientX - sr.startX;
        const elapsed = Date.now() - sr.startTime;
        const absDx = Math.abs(dx);

        if (absDx > 60) {
          if (elapsed < 400) {
            // ── 빠른 스와이프 → 페이지 이동 ──
            if (dx < 0) {
              // 왼쪽 → 다음 페이지
              const cur = live.current.pageIdx;
              if (cur < pagesLenRef.current - 1) goToPageRef.current(cur + 1);
            } else {
              // 오른쪽 → 이전 페이지
              const cur = live.current.pageIdx;
              if (cur > 0) goToPageRef.current(cur - 1);
            }
            setSwipeHint('idle'); setSwipeProgress(0);
          } else if (dx < -80) {
            // ── 느린 왼쪽 스와이프 → 새 페이지 추가 ──
            addPageRef.current();
            setSwipeProgress(1);
            setTimeout(() => { setSwipeHint('idle'); setSwipeProgress(0); }, 500);
          } else {
            setSwipeHint('idle'); setSwipeProgress(0);
          }
        } else {
          setSwipeHint('idle'); setSwipeProgress(0);
        }
      } else {
        setSwipeHint('idle'); setSwipeProgress(0);
      }
      swipeTouchRef.current = null;
    };

    container.addEventListener('touchstart',  onTouchStart, { passive: true });
    container.addEventListener('touchmove',   onTouchMove,  { passive: false });
    container.addEventListener('touchend',    onTouchEnd,   { passive: true });
    container.addEventListener('touchcancel', onTouchEnd,   { passive: true });

    // ② 캔버스 원소 자체에도 팜 차단 유지 (포인터 이벤트 레이어)
    const blockCanvasTouch = (e: TouchEvent) => {
      if (live.current.penOnlyMode) { e.preventDefault(); }
    };
    [baseCanvasRef.current, activeCanvasRef.current].forEach(c => {
      if (!c) return;
      c.addEventListener('touchstart', blockCanvasTouch, { passive: false });
      c.addEventListener('touchmove',  blockCanvasTouch, { passive: false });
    });

    return () => {
      container.removeEventListener('touchstart',  onTouchStart);
      container.removeEventListener('touchmove',   onTouchMove);
      container.removeEventListener('touchend',    onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      [baseCanvasRef.current, activeCanvasRef.current].forEach(c => {
        if (!c) return;
        c.removeEventListener('touchstart', blockCanvasTouch);
        c.removeEventListener('touchmove',  blockCanvasTouch);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const xfmScale = canvasXformRef.current.scale;
      const p: Point = { x: (e.clientX - rect.left) / xfmScale, y: (e.clientY - rect.top) / xfmScale, pressure: e.pressure > 0 ? e.pressure : 0.5, t: Date.now() };
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
      const xfmScale = canvasXformRef.current.scale;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p: Point = { x: (ev.clientX - rect.left) / xfmScale, y: (ev.clientY - rect.top) / xfmScale, pressure: ev.pressure > 0 ? ev.pressure : 0.5, t: Date.now() };
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

  // ── 사진 첨부 ──────────────────────────────────────────────────────────────
  const importImage = useCallback(async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    // 최대 1600px로 압축
    const compressed = await compress(dataUrl, 1600, 0.88);
    const idx = live.current.pageIdx;
    // pageImages 배열 업데이트
    setPageImages(prev => {
      const next = [...prev];
      while (next.length <= idx) next.push(undefined);
      next[idx] = compressed;
      pageImagesRef.current = next; // ref도 동기화
      return next;
    });
    // 즉시 렌더
    const ui = new Image();
    ui.onload = () => { pageUserImgRef.current = ui; redrawBase(); };
    ui.src = compressed;
  }, [redrawBase]);

  // 현재 페이지 사진 제거
  const removePageImage = useCallback(() => {
    const idx = live.current.pageIdx;
    setPageImages(prev => {
      const next = [...prev];
      next[idx] = undefined;
      pageImagesRef.current = next;
      return next;
    });
    pageUserImgRef.current = null;
    redrawBase();
  }, [redrawBase]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    let rawUrl = getExportDataUrl();
    if (!rawUrl) {
      // 내보내기 실패 시 기존 이미지 유지 (노트 비어버리는 에러 방지)
      if (editingNote?.dataUrl) {
        console.warn('[damoa-pen] 내보내기 실패 — 기존 이미지 유지');
        rawUrl = editingNote.dataUrl;
      } else {
        return; // 신규 노트인데 내보내기 실패면 저장 안 함
      }
    }
    const dataUrl = await compress(rawUrl, 1200, 0.75);
    if (!dataUrl || dataUrl.length < 200) {
      console.error('[damoa-pen] compress 결과 비어있음, 저장 중단');
      return;
    }
    let finalOcr = ocrText;
    if (strokesRef.current.length > 0 && !ocrText) {
      try { const t = await handleOcr(dataUrl); if (t) finalOcr = t; } catch {}
    }
    // 태그 파싱
    const finalTags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    if (finalTags.length) setTags(finalTags);
    // 전체 페이지 스트로크 수집 (현재 페이지는 strokesRef로 최신화)
    const allPageStrokes = pages.map((p, i) =>
      i === live.current.pageIdx ? [...strokesRef.current] : p.strokes
    ) as SavedStroke[][];
    // 현재 펜 설정 수집
    const currentPenSettings: PenSettings = {
      penType:          live.current.penType,
      penSize:          live.current.penSize,
      penColor:         live.current.penColor,
      fountainIntensity:live.current.fountainIntensity,
    };
    const currentPageImages = pageImagesRef.current;
    onSave(
      dataUrl, finalOcr, title, live.current.paperType,
      finalTags, noteFolderId,
      pdfBase64, pdfText, pdfPageCount,
      allPageStrokes.some(s => s.length > 0) ? allPageStrokes : undefined,
      currentPenSettings,
      currentPageImages.some(Boolean) ? currentPageImages : undefined,
      editingNote?.id,
    );
  };

  // ── Pages ─────────────────────────────────────────────────────────────────
  const goToPage = (idx: number) => {
    setPageIdx(idx);
    strokesRef.current = pages[idx]?.strokes || [];
    baseImageRef.current = null;

    // 해당 페이지 첨부 사진 로드
    const userImgSrc = pageImagesRef.current[idx];
    pageUserImgRef.current = null;
    if (userImgSrc) {
      const ui = new Image();
      ui.onload = () => { pageUserImgRef.current = ui; redrawBase(); };
      ui.src = userImgSrc;
    }

    if (pdfDocRef.current) {
      loadPageBg(idx);
    } else {
      pageBgImageRef.current = null;
      redrawBase();
    }
    clearActive();
  };
  const addPage = () => {
    const newPg = { id: `p-${pages.length+1}`, strokes: [] as Stroke[] };
    const updated = [...pages, newPg]; setPages(updated);
    const ni = updated.length - 1; setPageIdx(ni);
    strokesRef.current = []; baseImageRef.current = null;
    pageUserImgRef.current = null; // 새 페이지는 사진 없음
    redrawBase(); clearActive();
  };
  addPageRef.current  = addPage;  // 스와이프 핸들러가 최신 addPage를 호출하도록
  goToPageRef.current = goToPage; // 스와이프 핸들러가 최신 goToPage를 호출하도록
  pagesLenRef.current = pages.length; // 스와이프 핸들러에서 페이지 수 확인용

  // ── PDF 임포트 (원본 방식) ───────────────────────────────────────────────
  const importPdf = useCallback(async (file: File) => {
    const pdfjsLib = initPdfJs();
    if (!pdfjsLib) { alert('pdf.js가 로드되지 않았습니다. 인터넷 연결을 확인해주세요.'); return; }
    setLoadingPdf(true);
    try {
      const arrayBuffer = await file.arrayBuffer();

      // ① PDF 원본 → base64 저장
      const bytes = new Uint8Array(arrayBuffer);
      let bin = '';
      // 청크 단위로 변환 (스택 오버플로우 방지)
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(bin);

      // ② pdf.js로 로드
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfDocRef.current = pdf;
      pdfCacheRef.current.clear();

      // ③ 텍스트 추출 (getTextContent) — 모든 페이지
      let extractedText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        extractedText += tc.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ') + '\n';
      }

      // ④ 빈 페이지 구조 설정
      const newPages: Page[] = Array.from({ length: pdf.numPages }, (_, i) => ({
        id: `p-pdf-${i + 1}`, strokes: [],
      }));
      setPages(newPages);
      setPageIdx(0);
      setPdfBase64(base64);
      setPdfText(extractedText.trim());
      setPdfPageCount(pdf.numPages);
      strokesRef.current = [];
      baseImageRef.current = null;

      // ⑤ 1페이지 즉시 렌더
      await loadPageBg(0);
      setTimeout(() => clearActive(), 30);

      // ⑥ 나머지 페이지 백그라운드 렌더
      setTimeout(async () => {
        for (let i = 1; i < pdf.numPages; i++) {
          setPdfRenderMsg(`백그라운드 렌더 ${i + 1}/${pdf.numPages}`);
          await renderPdfPage(i);
        }
        setPdfRenderMsg(null);
      }, 300);

    } catch (e) {
      alert('PDF 불러오기 실패: ' + (e as Error).message);
    } finally {
      setLoadingPdf(false);
    }
  }, [loadPageBg, renderPdfPage, clearActive]);

  const bgColor = paperType==='black'?'#1a1a1a':paperType==='yellow'?'#fef9c3':'#ffffff';
  const isHL = penType === 'highlighter';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col h-dvh overflow-hidden" style={{paddingBottom:'env(safe-area-inset-bottom,0)'}}>

      {/* ── 탭 바 ── */}
      {openTabs && openTabs.length > 0 && (
        <div className="flex items-center bg-stone-200 dark:bg-slate-900 border-b border-stone-300 dark:border-slate-700 overflow-x-auto"
          style={{touchAction:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch'}}>
          {openTabs.map((tab, i) => (
            <div key={i}
              className={`flex items-center gap-1 px-2 py-1.5 text-xs font-bold cursor-pointer shrink-0 border-b-2 transition-colors ${i === activeTabIdxProp ? 'bg-stone-100 dark:bg-slate-800 border-purple-500 text-stone-900 dark:text-white' : 'border-transparent text-stone-500 dark:text-slate-400 hover:bg-stone-150 dark:hover:bg-slate-800/60'}`}
              onClick={() => onTabSwitch?.(i)}>
              {/* 탭 색상 점 (클릭으로 색상 순환) */}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 cursor-pointer ring-1 ring-white/40"
                style={{background: tab.color}}
                onClick={e => { e.stopPropagation(); onTabColorCycle?.(i); }}
              />
              {/* 탭 제목 */}
              <span className="max-w-[80px] truncate">{tab.title}</span>
              {/* 닫기 버튼 */}
              <button type="button"
                className="ml-0.5 rounded-full text-stone-400 hover:text-red-400 dark:hover:text-red-400 cursor-pointer"
                onClick={e => { e.stopPropagation(); onTabClose?.(i); }}>
                <X className="w-3 h-3"/>
              </button>
            </div>
          ))}
          {/* 새 탭 버튼 */}
          <button type="button" title="새 노트 탭"
            onClick={onNewTab}
            className="flex items-center justify-center px-2 py-1.5 text-stone-400 dark:text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 cursor-pointer shrink-0">
            <Plus className="w-3.5 h-3.5"/>
          </button>
        </div>
      )}

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
            className="flex items-center gap-1 px-2 py-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-black cursor-pointer text-stone-700 dark:text-slate-200">
            {toolbarCollapsed ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronUp className="w-3.5 h-3.5"/>}
          </button>

          <button type="button" onClick={handleSave}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1 shadow-md cursor-pointer active:scale-95">
            <Check className="w-4 h-4"/><span>저장</span>
          </button>
        </div>

        {/* Row 2: pen tools (icon-only) */}
        <div className={`${toolbarCollapsed?'hidden':'flex'} items-center gap-1 flex-wrap`}>

          {/* ── Pen type selector ── */}
          <div className="relative">
            <button type="button" title={PEN_LABELS[penType]}
              onClick={() => { setShowPenMenu(!showPenMenu); setShowColorPicker(false); setShowSizePicker(false); setShowEraserMenu(false); setShowPaperMenu(false); setShowSettingsPanel(false); }}
              className={`border font-extrabold text-sm px-2 py-1.5 rounded-xl flex items-center gap-0.5 cursor-pointer shadow-sm ${isEraser?'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-200':'bg-purple-600 border-purple-700 text-white'}`}>
              <span>{PEN_ICONS[penType]}</span>
              <span className="text-[9px] opacity-60">▾</span>
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
                      {[{label:'약',val:0.7},{label:'중',val:1.0},{label:'강',val:2.0}].map(({label,val}) => (
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
            <button type="button" title="색상"
              onClick={() => { setShowColorPicker(!showColorPicker); setShowSizePicker(false); setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false); setShowSettingsPanel(false); }}
              className="bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 px-2 py-1.5 rounded-xl flex items-center gap-0.5 cursor-pointer shadow-sm hover:bg-stone-50">
              <span className="w-4 h-4 rounded-full border border-stone-300 shrink-0"
                style={{backgroundColor: isEraser ? '#9ca3af' : penColor, opacity: isHL ? 0.5 : 1}}/>
              <span className="text-[9px] text-stone-400">▾</span>
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
            <button type="button" title={`굵기 ${penSize.toFixed(1)}px`}
              onClick={() => { setShowSizePicker(!showSizePicker); setShowColorPicker(false); setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false); setShowSettingsPanel(false); }}
              className="bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 px-2 py-1.5 rounded-xl flex items-center gap-0.5 cursor-pointer shadow-sm hover:bg-stone-50 text-stone-800 dark:text-slate-200">
              <span className="flex items-center justify-center w-4 h-4">
                <span className="rounded-full bg-current" style={{width:Math.max(3,Math.min(12,penSize))+'px',height:Math.max(3,Math.min(12,penSize))+'px'}}/>
              </span>
              <span className="text-[9px] text-stone-400">▾</span>
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
              <button type="button" title={isEraser?(eraserType==='stroke'?'획지우개':'부분지우개'):'지우개'}
                onClick={() => { setIsEraser(!isEraser); setShowEraserMenu(false); }}
                className="px-2 py-1.5 font-extrabold text-xs flex items-center gap-1 cursor-pointer active:scale-95">
                <Eraser className="w-4 h-4"/>
              </button>
              <button type="button"
                onClick={() => { setShowEraserMenu(!showEraserMenu); setShowColorPicker(false); setShowSizePicker(false); setShowPenMenu(false); setShowPaperMenu(false); setShowSettingsPanel(false); }}
                className={`px-1 py-1.5 border-l text-[9px] cursor-pointer hover:bg-black/10 ${isEraser?'border-purple-500':'border-stone-200 dark:border-slate-700 text-stone-500'}`}>▾</button>
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

          {/* ── 종이 설정 (Settings 패널 토글) ── */}
          <button type="button" title="종이 설정"
            onClick={() => { setShowSettingsPanel(!showSettingsPanel); setShowColorPicker(false); setShowSizePicker(false); setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false); }}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-black border cursor-pointer shadow-sm ${showSettingsPanel?'bg-stone-700 dark:bg-slate-600 text-white border-stone-700':'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-200'}`}>
            <span>{paperType==='black'?'🖤':paperType==='yellow'?'📒':'📄'}</span>
            <Settings className="w-3.5 h-3.5"/>
          </button>

          {/* ── Palm rejection ── */}
          <button type="button" title={penOnlyMode ? '펜 전용 (터치 차단)' : '터치+펜 허용'}
            onClick={() => setPenOnlyMode(!penOnlyMode)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-black border cursor-pointer ${penOnlyMode?'bg-purple-100 dark:bg-purple-950/60 border-purple-300 text-purple-900 ring-2 ring-purple-200/80':'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-300'}`}>
            <Hand className="w-4 h-4 text-purple-600"/>
          </button>

          {/* ── 핀치 줌 ── */}
          {/* ── 핀치 줌 ── */}
          <button type="button" title={zoomEnabled ? `줌 ${Math.round(canvasXform.scale*100)}%` : '줌'}
            onClick={() => {
              if (zoomEnabled && !zoomLocked) {
                // 잠금 아닐 때만 리셋
                const id = { scale: 1, x: 0, y: 0 };
                canvasXformRef.current = id;
                setCanvasXform(id);
                cachedRectRef.current = null;
              }
              setZoomEnabled(z => !z);
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-black border cursor-pointer ${zoomEnabled?'bg-blue-100 dark:bg-blue-950/60 border-blue-300 text-blue-900 dark:text-blue-100 ring-2 ring-blue-200/80':'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-300'}`}>
            <span className="text-sm leading-none">🔍</span>
            {canvasXform.scale !== 1 && (
              <span className="text-[10px] font-black">{Math.round(canvasXform.scale*100)}%</span>
            )}
          </button>

          {/* ── 줌 잠금 ── */}
          {(zoomEnabled || zoomLocked) && (
            <button type="button" title={zoomLocked ? '줌 잠금 해제 (리셋)' : '현재 배율 고정'}
              onClick={() => {
                if (zoomLocked) {
                  // 잠금 해제 + 리셋
                  setZoomLocked(false);
                  const id = { scale: 1, x: 0, y: 0 };
                  canvasXformRef.current = id;
                  setCanvasXform(id);
                  cachedRectRef.current = null;
                } else {
                  setZoomLocked(true);
                }
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-black border cursor-pointer ${zoomLocked?'bg-amber-100 dark:bg-amber-950/60 border-amber-400 text-amber-800 dark:text-amber-200 ring-2 ring-amber-200':'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-400'}`}>
              {zoomLocked ? <Lock className="w-3.5 h-3.5"/> : <Unlock className="w-3.5 h-3.5"/>}
            </button>
          )}

          {/* ── OCR ── */}
          <button type="button" title={isOcrLoading ? '판독 중...' : ocrText ? 'AI 완료' : 'AI 인식'}
            disabled={isOcrLoading} onClick={() => handleOcr()}
            className={`px-2 py-1.5 rounded-xl flex items-center cursor-pointer shadow-sm active:scale-95 disabled:opacity-50 text-white shrink-0 ${isOcrLoading?'bg-purple-500':ocrText?'bg-blue-500 hover:bg-blue-600':'bg-red-500 hover:bg-red-600 animate-pulse'}`}>
            <Sparkles className="w-4 h-4"/>
          </button>

          {/* ── PDF 임포트 ── */}
          <button type="button" title={loadingPdf ? 'PDF 로딩...' : pdfBase64 ? 'PDF 첨부됨' : 'PDF 첨부'}
            disabled={loadingPdf}
            onClick={() => pdfInputRef.current?.click()}
            className={`px-2 py-1.5 rounded-xl flex items-center cursor-pointer shadow-sm text-white shrink-0 disabled:opacity-50 active:scale-95 ${pdfBase64 ? 'bg-amber-600 hover:bg-amber-700 ring-2 ring-amber-300' : 'bg-amber-500 hover:bg-amber-600'}`}>
            <FileText className="w-4 h-4"/>
          </button>
          <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = ''; }}/>

          {/* ── 사진 첨부 ── */}
          <div className="flex items-center gap-0.5">
            <button type="button" title={pageImages[pageIdx] ? '사진 첨부됨' : '사진 첨부'}
              onClick={() => imgInputRef.current?.click()}
              className={`px-2 py-1.5 rounded-xl flex items-center cursor-pointer shadow-sm active:scale-95 text-white shrink-0 ${pageImages[pageIdx] ? 'bg-green-600 hover:bg-green-700 ring-2 ring-green-300' : 'bg-teal-500 hover:bg-teal-600'}`}>
              <span className="text-sm leading-none">🖼️</span>
            </button>
            {pageImages[pageIdx] && (
              <button type="button" title="사진 제거" onClick={removePageImage}
                className="p-1.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-xl cursor-pointer shadow-sm active:scale-95 shrink-0">
                <X className="w-3.5 h-3.5"/>
              </button>
            )}
          </div>
          <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importImage(f); e.target.value = ''; }}/>

          {/* ── 노트 정보 (태그/폴더) ── */}
          <button type="button" title="태그/폴더"
            onClick={() => setShowNoteInfo(!showNoteInfo)}
            className={`px-2 py-1.5 rounded-xl flex items-center cursor-pointer shadow-sm shrink-0 ${showNoteInfo?'bg-purple-600 text-white':'bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-300'}`}>
            <Tag className="w-4 h-4"/>
          </button>
        </div>

        {/* Row 2.5: 종이 설정 패널 */}
        {showSettingsPanel && (
          <div className="mt-1 border-t border-stone-200 dark:border-slate-700 pt-2 flex flex-col gap-2.5">
            {/* 종이 색상 */}
            <div>
              <div className="text-[10px] font-black text-stone-400 dark:text-slate-500 mb-1.5 uppercase tracking-wider">종이 색상</div>
              <div className="flex gap-1.5">
                {(['white','yellow','black'] as const).map(pt => (
                  <button key={pt} type="button"
                    onClick={() => {
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
            </div>
            {/* 줄 표시 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-black text-stone-400 dark:text-slate-500 uppercase tracking-wider">줄 표시</div>
                <button type="button" onClick={() => setShowLines(!showLines)}
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black cursor-pointer ${showLines?'bg-purple-600 text-white':'bg-stone-200 dark:bg-slate-700 text-stone-600 dark:text-slate-300'}`}>
                  {showLines?'ON':'OFF'}
                </button>
              </div>
              {showLines && (
                <div className="flex gap-1">
                  {[24,30,36,44].map(sp => (
                    <button key={sp} type="button" onClick={() => setLineSpacing(sp)}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-black cursor-pointer ${lineSpacing===sp?'bg-purple-600 text-white':'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
                      {sp}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Row 3: 태그 / 폴더 (토글) */}
        {showNoteInfo && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-stone-200 dark:border-slate-700">
            {/* 태그 입력 */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Tag className="w-3.5 h-3.5 text-purple-500 shrink-0"/>
              <input
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="태그 (쉼표로 구분: 월간지, 업무)"
                inputMode="text"
                className="flex-1 text-xs bg-stone-100 dark:bg-slate-800 rounded-xl px-2.5 py-1.5 outline-none text-stone-800 dark:text-slate-200 placeholder-stone-400"
                style={{touchAction:'auto'}}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              />
            </div>
            {/* 폴더 선택 */}
            {folders.length > 0 && (
              <div className="flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-purple-500 shrink-0"/>
                <select
                  value={noteFolderId ?? ''}
                  onChange={e => setNoteFolderId(e.target.value || undefined)}
                  className="text-xs bg-stone-100 dark:bg-slate-800 rounded-xl px-2 py-1.5 outline-none text-stone-800 dark:text-slate-200 cursor-pointer"
                  style={{touchAction:'auto'}}
                  onPointerDown={e => e.stopPropagation()}>
                  <option value="">폴더 없음</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* 현재 태그 뱃지 */}
            {tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {tags.map(t => (
                  <span key={t} className="px-2 py-0.5 bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold rounded-full">#{t}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* OCR message */}
      {ocrMsg && (
        <div className="px-3 py-1.5 bg-purple-50 dark:bg-purple-950/40 border-b border-purple-200 text-xs font-bold text-purple-900 dark:text-purple-200 flex items-center justify-between gap-2">
          <span className="truncate">{ocrMsg}</span>
          <button type="button" onClick={() => setOcrMsg(null)} className="text-purple-400 hover:text-purple-700 font-black cursor-pointer shrink-0">✕</button>
        </div>
      )}
      {/* PDF 백그라운드 렌더 진행 */}
      {pdfRenderMsg && (
        <div className="px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <span className="animate-pulse">⚡</span>
          <span>{pdfRenderMsg} — 페이지 이동 시 즉시 표시됩니다</span>
        </div>
      )}

      {/* ── Canvas ── */}
      <div ref={containerRef} className="relative w-full flex-1 overflow-hidden select-none"
        style={{touchAction:'none', overscrollBehavior:'none', backgroundColor:bgColor}}>
        {/* 줌/패닝 wrapper — CSS transform으로 확대/축소 처리, 캔버스 자체 해상도는 불변 */}
        <div ref={canvasWrapRef} className="absolute inset-0"
          style={{
            touchAction: 'none',
            transform: `translate(${canvasXform.x}px,${canvasXform.y}px) scale(${canvasXform.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}>
          <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full block"
            style={{touchAction:'none', userSelect:'none', willChange:'transform'}}/>
          <canvas ref={activeCanvasRef} className="absolute inset-0 w-full h-full block"
            style={{touchAction:'none', userSelect:'none', willChange:'transform', background:'transparent'}}/>
        </div>

        {/* ── 스와이프 새 페이지 힌트 ── */}
        {swipeHint === 'hinting' && (
          <div className="absolute inset-y-0 right-0 flex items-center justify-end pointer-events-none"
            style={{width:`${Math.max(60, swipeProgress * 200)}px`, opacity: Math.min(1, swipeProgress * 1.5)}}>
            <div className="flex flex-col items-center gap-2 pr-4"
              style={{transform:`translateX(${(1-swipeProgress)*40}px)`, transition:'transform 0.05s linear'}}>
              <div className="text-2xl animate-bounce">←</div>
              <div className="text-white font-black text-xs text-center leading-tight px-3 py-2 rounded-2xl shadow-xl"
                style={{background:'rgba(124,58,237,0.85)', backdropFilter:'blur(4px)'}}>
                ← 새 페이지 추가
              </div>
              {swipeProgress > 0.6 && (
                <div className="text-white text-[10px] font-bold opacity-80">
                  손 떼면 추가됩니다
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 페이지 스크러버 (3페이지 이상일 때 표시) ── */}
      {pages.length > 2 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-50 dark:bg-slate-900 border-t border-stone-200 dark:border-slate-800"
          style={{touchAction:'auto'}}
          onPointerDown={e => e.stopPropagation()}>
          <span className="text-[10px] font-bold text-stone-400 w-5 text-right shrink-0">1</span>
          <input
            type="range"
            min={0}
            max={pages.length - 1}
            value={pageIdx}
            onChange={e => goToPage(parseInt(e.target.value))}
            className="flex-1 accent-purple-600 cursor-pointer"
            style={{touchAction:'auto', height:'4px'}}
            onPointerDown={e => e.stopPropagation()}
          />
          <span className="text-[10px] font-bold text-stone-400 w-5 shrink-0">{pages.length}</span>
          <span className="text-[10px] font-black text-purple-600 shrink-0">{pageIdx+1}p</span>
        </div>
      )}

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
