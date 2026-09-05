import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Eraser, Trash2, Check, Sparkles,
  Hand, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  FileText, FolderOpen, Tag, Lock, Unlock, Settings, X, Plus,
  Undo2, Redo2, Search, Image as ImageIcon,
} from 'lucide-react';
import { PenNote, Folder, PenType, StrokePoint, SavedStroke, PenSettings, WordBox } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────
type Point = StrokePoint; // StrokePoint와 동일, 로컬 별칭

interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  penType: PenType;
  fountainIntensity: number;
  opacity?: number;   // 형광펜 투명도 (기본 0.38)
  straight?: boolean; // 형광펜 직선 모드
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
    pageOcrTexts?: string[],
    pageWordBoxes?: WordBox[][],
    ocrCanvasDims?: { w: number; h: number },
  ) => void;
  onBack: () => void;
  initialSearchQuery?: string; // 검색어 → 해당 페이지로 이동
  // Tab system
  openTabs?: Array<{ noteId: string | null; title: string; color: string }>;
  activeTabIdx?: number;
  onTabSwitch?: (newIdx: number) => void;
  onTabClose?: (idx: number) => void;
  onTabColorCycle?: (idx: number) => void;
  onTabEdit?: (idx: number) => void;
  onTabTitleChange?: (idx: number, title: string) => void;
  onTabColorSet?: (idx: number, color: string) => void;
  tabEditIdx?: number | null;
  onNewTab?: () => void;
  onAutoSave?: (noteId: string | undefined, strokes: SavedStroke[][]) => void;
  initialPageIdx?: number;
  onPageChange?: (pageIdx: number) => void;
  // 페이지 병합
  allNotes?: PenNote[];
  onMergePages?: (sourcePageIdxes: number[], targetNoteId: string, insertAfter: number) => Promise<void>;
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
  pen:          '볼펜',
  fountain:     '만년필',
  highlighter:  '형광펜',
  penFountain:  '볼펜+만년필',
};

const PEN_ICONS: Record<PenType, string> = {
  pen:          '🖊️',
  fountain:     '✒️',
  highlighter:  '🖍️',
  penFountain:  '🖊️✒️',
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
  stroke: Pick<Stroke, 'color'|'size'|'penType'|'fountainIntensity'|'opacity'>,
  pressure = 1,
) {
  const { color, size, penType, fountainIntensity } = stroke;
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  if (penType === 'highlighter') {
    ctx.globalAlpha = stroke.opacity ?? 0.38;
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
  } else if (penType === 'penFountain') {
    // 볼펜+만년필: 볼펜 기반 + 미세 필압 (live 드로잉 / appendSegment 용)
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    const p = Math.max(0.2, Math.min(pressure, 1));
    ctx.lineWidth   = Math.max(0.4, size * (0.82 + p * 0.18));
    ctx.globalCompositeOperation = 'source-over';
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

/** Laplacian smoothing: 펜 뗀 후 포인트 좌표 부드럽게 정제 (시작/끝점 고정) */
function laplacianSmooth(pts: Point[], iterations = 3): Point[] {
  if (pts.length <= 2) return pts;
  let result = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [result[0]];
    for (let i = 1; i < result.length - 1; i++) {
      next.push({
        x: (result[i - 1].x + result[i].x * 2 + result[i + 1].x) / 4,
        y: (result[i - 1].y + result[i].y * 2 + result[i + 1].y) / 4,
        pressure: result[i].pressure,
        t: result[i].t,
      });
    }
    next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}

function drawStroke(stroke: Stroke, ctx: CanvasRenderingContext2D) {
  const pts = stroke.points;
  if (!pts?.length) return;

  if (stroke.penType === 'fountain') {
    // Per-segment varying width, quadratic bezier for smoothness
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
      // 세그먼트 연결부 gap 방지: 각 포인트에 채움 원 추가
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, Math.max(0.2, ctx.lineWidth / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      if (i === 1 || i === pts.length - 1) {
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      } else {
        const p0 = pts[i-2];
        const mx1 = (p0.x + p1.x) / 2, my1 = (p0.y + p1.y) / 2;
        const mx2 = (p1.x + p2.x) / 2, my2 = (p1.y + p2.y) / 2;
        ctx.moveTo(mx1, my1); ctx.quadraticCurveTo(p1.x, p1.y, mx2, my2);
      }
      ctx.stroke();
    }
    resetCtxState(ctx); return;
  }

  if (stroke.penType === 'penFountain') {
    // 볼펜+만년필: 세그먼트별 tapering + 미세 필압
    // fountainIntensity: 0=없음, 0.5=약, 1.0=중, 2.0=강 (획끝 강도 슬라이더)
    const n = pts.length;
    if (n === 1) {
      ctx.globalAlpha = 1; ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, Math.max(0.2, stroke.size / 2), 0, Math.PI * 2);
      ctx.fill(); resetCtxState(ctx); return;
    }
    const fi = stroke.fountainIntensity ?? 0.5;
    // taperLen: fi=0→없음, fi=0.5→5%, fi=1.0→8%, fi=2.0→14%
    const taperLen = fi <= 0 ? 0 : Math.max(2, Math.min(20, Math.floor(n * 0.07 * fi)));
    // minTaper: 획끝이 최소 이 비율까지만 가늘어짐 (fi=0→1.0, fi=0.5→0.85, fi=1→0.72, fi=2→0.55)
    const minTaper = fi <= 0 ? 1.0 : Math.max(0.4, 1.0 - fi * 0.225);

    for (let i = 0; i < n - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      // tapering
      const distFromEdge = Math.min(i + 1, n - 1 - i);
      const rawTaper = taperLen > 0 ? Math.min(distFromEdge / taperLen, 1) : 1;
      const taperFactor = minTaper + (1 - minTaper) * Math.sqrt(rawTaper);
      // 미세 필압 (볼펜 기반 ±18%)
      const avgP = (p1.pressure + p2.pressure) / 2;
      const pressureFactor = 0.82 + Math.max(0.2, Math.min(avgP, 1)) * 0.18;
      const width = Math.max(0.4, stroke.size * pressureFactor * taperFactor);

      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';
      // gap 방지: 각 시작점에 채움 원
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, Math.max(0.2, width / 2), 0, Math.PI * 2);
      ctx.fill();
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
  stroke: Pick<Stroke, 'color'|'size'|'penType'|'fountainIntensity'|'opacity'>,
  pts: Point[],
) {
  if (pts.length < 2) return;
  const len = pts.length;
  const p1 = pts[len-2], p2 = pts[len-1];

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
  initialSearchQuery,
  openTabs, activeTabIdx: activeTabIdxProp = 0,
  onTabSwitch, onTabClose, onTabColorCycle, onTabEdit, onTabTitleChange, onTabColorSet, tabEditIdx, onNewTab,
  onAutoSave,
  initialPageIdx,
  onPageChange,
  allNotes,
  onMergePages,
}) => {
  const baseCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef    = useRef<HTMLDivElement | null>(null);
  const isDrawingRef    = useRef(false);
  const currentStrokeRef= useRef<Stroke | null>(null);
  const strokesRef      = useRef<Stroke[]>([]);
  const baseImageRef    = useRef<HTMLImageElement | null>(null);
  const pageBgImageRef  = useRef<ImageBitmap | null>(null); // 현재 페이지 PDF 렌더 캐시 (ImageBitmap — 무손실)
  const cachedRectRef   = useRef<DOMRect | null>(null);
  const rafPendingRef   = useRef(false);
  const pdfInputRef     = useRef<HTMLInputElement | null>(null);
  const imgInputRef     = useRef<HTMLInputElement | null>(null); // 사진 첨부 input
  const pdfDocRef       = useRef<any>(null);               // pdf.js PDFDocumentProxy
  const pdfCacheRef     = useRef<Map<number, ImageBitmap>>(new Map()); // 인메모리 ImageBitmap 캐시 (무손실, GPU-backed)
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
  const [slideOffset,       setSlideOffset]       = useState(0);   // % translateX
  const [slideActive,       setSlideActive]       = useState(false);
  const pageTransitioning                         = useRef(false);
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
  const [pdfInvert,     setPdfInvert]    = useState(false); // PDF 반전 보기
  const [pageImages,    setPageImages]   = useState<(string|undefined)[]>(editingNote?.pageImages ?? []);
  // ── 페이지 병합 모달 ────────────────────────────────────────────────────────
  const [showMergeModal,   setShowMergeModal]   = useState(false);
  const [mergeTargetNote,  setMergeTargetNote]  = useState<string>(''); // target note id
  const [mergeSelPages,    setMergeSelPages]    = useState<number[]>([]);  // source page indexes
  const [mergeInsertAfter, setMergeInsertAfter] = useState<number>(-1); // -1 = 맨 앞
  const [mergeLoading,     setMergeLoading]     = useState(false);

  // ── 검색어 하이라이트 (캔버스 오버레이) ────────────────────────────────────
  const [searchHighlights, setSearchHighlights] = useState<{x:number;y:number;w:number;h:number}[]>([]);
  const [locatingSearch,   setLocatingSearch]   = useState(false);

  const swipeTouchRef          = useRef<{ id: number; startX: number; startY: number; startTime: number; classified: boolean; isSwipe: boolean } | null>(null);
  const addPageRef             = useRef<() => void>(() => {});
  const goToPageRef            = useRef<(idx: number) => void>(() => {});
  const animatedGoToPageRef    = useRef<(idx: number) => void>(() => {});
  const locateSearchTermRef    = useRef<(query: string, pageIdxOverride?: number) => void>(() => {});
  const pagesLenRef            = useRef<number>(1);
  const autoSaveTimerRef       = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const undoHistoriesRef = useRef<Map<string, Stroke[][]>>(new Map());
  const redoHistoriesRef = useRef<Map<string, Stroke[][]>>(new Map());
  const eraserUndoPushedRef = useRef(false);
  const canvasWrapRef  = useRef<HTMLDivElement | null>(null);
  const pinchRef       = useRef<{ t1Id: number; t2Id: number; startDist: number; startScale: number; midCanvasX: number; midCanvasY: number } | null>(null);
  const canvasXformRef = useRef({ scale: 1, x: 0, y: 0 });

  const [zoomEnabled,      setZoomEnabled]      = useState(false);
  const [zoomLocked,       setZoomLocked]       = useState(false);
  const [showSettingsPanel,setShowSettingsPanel] = useState(false);

  // ── 형광펜 설정 ───────────────────────────────────────────────────────────
  const [showHlMenu,       setShowHlMenu]       = useState(false);
  const [hlOpacity,        setHlOpacity]        = useState(0.38);
  const [hlStraight,       setHlStraight]       = useState(false);
  const hlStartRef = useRef<Point|null>(null);
  const [canvasXform, setCanvasXform] = useState({ scale: 1, x: 0, y: 0 });

  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const sizePickerRef  = useRef<HTMLDivElement | null>(null);
  const penMenuRef     = useRef<HTMLDivElement | null>(null);
  const eraserMenuRef  = useRef<HTMLDivElement | null>(null);
  const paperMenuRef   = useRef<HTMLDivElement | null>(null);
  const hlMenuRef      = useRef<HTMLDivElement | null>(null);

  const live = useRef({
    penOnlyMode: true,
    penColor: initPS?.penColor ?? (initPT === 'black' ? '#ffffff' : '#1c1917'),
    penSize: initPS?.penSize ?? 2, penType: (initPS?.penType ?? 'fountain') as PenType, fountainIntensity: initPS?.fountainIntensity ?? 1.0,
    isEraser: false, eraserType: 'stroke' as 'stroke'|'area',
    pageIdx: 0, autoReturnPen: true,
    paperType: initPT as 'white'|'yellow'|'black', showLines: true, lineSpacing: 30,
    zoomEnabled: false,
    hlOpacity: 0.38, hlStraight: false,
    pages: [] as Page[],
    editingNoteId: undefined as string | undefined,
    editingNote:   null as PenNote | null,
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
  live.current.hlOpacity          = hlOpacity;
  live.current.hlStraight         = hlStraight;
  live.current.pages              = pages;          // 자동저장용
  live.current.editingNoteId      = editingNote?.id; // 자동저장용
  live.current.editingNote        = editingNote;     // 오프라인 검색용
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
    // PDF 페이지 배경 (종이색 위, 스트로크 아래) — contain 방식으로 원본 비율 유지 (ImageBitmap 무손실)
    if (pageBgImageRef.current) {
      const pi = pageBgImageRef.current; // ImageBitmap
      const sc = Math.min(cssW / pi.width, cssH / pi.height); // .width/.height (ImageBitmap API)
      const pw = pi.width * sc, ph = pi.height * sc;
      const px = (cssW - pw) / 2; // 좌우 중앙
      ctx.globalAlpha = 1;
      ctx.drawImage(pi, px, 0, pw, ph); // 상단 정렬
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
  // LRU 캐시 최대 크기: ImageBitmap은 GPU 메모리를 점유하므로 10페이지로 제한
  // (A4 DPR=2 기준 한 페이지 ≈ 10~20MB GPU → 10페이지 ≈ 100~200MB)
  const PDF_CACHE_MAX = 10;

  /**
   * 페이지 인덱스(0-based)를 ImageBitmap으로 렌더. LRU 메모리 캐시 우선.
   * JPEG 인코딩 없이 GPU-backed ImageBitmap으로 캐시 → 화질 무손실.
   * 렌더 스케일 = DPR (물리 픽셀 1:1) — 최대 2.5배 제한.
   */
  const renderPdfPage = useCallback(async (idx: number): Promise<ImageBitmap | null> => {
    // 1. LRU 캐시 확인 — Map은 삽입 순서 유지 → 오래된 것이 앞
    const cache = pdfCacheRef.current;
    if (cache.has(idx)) {
      // LRU 갱신: 삭제 후 재삽입
      const hit = cache.get(idx)!;
      cache.delete(idx);
      cache.set(idx, hit);
      return hit;
    }
    // 2. pdf.js 렌더
    if (!pdfDocRef.current) return null;
    try {
      const page = await pdfDocRef.current.getPage(idx + 1);
      const container = containerRef.current;
      const cssW = container?.clientWidth  || 800;
      const cssH = container?.clientHeight || 600;
      // DPR 기반 스케일 (최대 2.5 — 메모리/화질 균형)
      const dpr   = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp0   = page.getViewport({ scale: 1 });
      const scale = Math.min(cssW / vp0.width, cssH / vp0.height) * dpr;
      const vp    = page.getViewport({ scale });
      const c     = document.createElement('canvas');
      c.width  = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      // JPEG 변환 없이 ImageBitmap으로 직접 추출 (무손실)
      const bmp = await createImageBitmap(c);

      // LRU 캐시 크기 초과 시 가장 오래된 항목 해제
      if (cache.size >= PDF_CACHE_MAX) {
        // 현재 표시 중 페이지(live.current.pageIdx)와 렌더 요청 페이지(idx)는 퇴거 금지
        const protectedIdx = live.current.pageIdx;
        for (const [k] of cache) {
          if (k !== idx && k !== protectedIdx) {
            cache.get(k)?.close();
            cache.delete(k);
            break; // 한 번에 하나씩 퇴거
          }
        }
      }
      cache.set(idx, bmp);
      return bmp;
    } catch (e) {
      console.error(`[damoa-pen] PDF 페이지 ${idx+1} 렌더 실패:`, e);
      return null;
    }
  }, []); // 의존성 없음 — ref만 사용

  /** 페이지 idx를 렌더해서 캔버스 배경으로 표시 */
  const loadPageBg = useCallback(async (idx: number) => {
    const bmp = await renderPdfPage(idx);
    if (!bmp) { pageBgImageRef.current = null; redrawBase(); return; }
    pageBgImageRef.current = bmp;
    redrawBase();
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
    // PDF/캐시 초기화 — ImageBitmap GPU 메모리 해제
    pdfDocRef.current = null;
    pdfCacheRef.current.forEach(bmp => bmp.close());
    pdfCacheRef.current.clear();
    // pageBgImageRef는 pdfCacheRef와 동일 객체를 참조 → close()는 위에서 이미 처리
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
      const startPage = Math.min(initialPageIdx ?? 0, restored.length - 1);
      setPages(restored);
      setPageIdx(startPage);
      strokesRef.current = restored[startPage]?.strokes ?? [];
      baseImageRef.current = null;

      // pdf.js로 로드 후 시작 페이지 즉시 렌더, 나머지 백그라운드
      const pdfjsLib = initPdfJs();
      if (pdfjsLib) {
        const binary = atob(editingNote.pdfBase64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        pdfjsLib.getDocument({ data: bytes.buffer }).promise
          .then(async (pdf: any) => {
            pdfDocRef.current = pdf;
            await loadPageBg(startPage);
            // 백그라운드: 다음 4페이지만 미리 렌더 (메모리 절약)
            const prefetchEnd = Math.min(5, count);
            for (let i = 1; i < prefetchEnd; i++) {
              setPdfRenderMsg(`PDF 미리 렌더 ${i+1}/${count}...`);
              await renderPdfPage(i);
            }
            setPdfRenderMsg(null);
          })
          .catch((e: Error) => console.error('[damoa-pen] PDF 로드 실패:', e));
      }
    } else {
      // ── 일반 손글씨 노트 ──
      setPdfBase64(undefined); setPdfText(undefined); setPdfPageCount(undefined);

      const savedStrokes = editingNote?.pageStrokes;
      const hasPageStrokes = savedStrokes && savedStrokes.some(p => p.length > 0);

      if (hasPageStrokes) {
        // pageStrokes가 있으면 벡터로 복원 → 두겹 방지, 다중 페이지 복원
        const restored: Page[] = savedStrokes.map((s, i) => ({
          id: `p${i + 1}`,
          strokes: s as Stroke[],
        }));
        const startPage = Math.min(initialPageIdx ?? 0, restored.length - 1);
        setPages(restored);
        setPageIdx(startPage);
        strokesRef.current = (restored[startPage]?.strokes ?? []) as Stroke[];
        baseImageRef.current = null;
        redrawBase();
      } else if (editingNote?.dataUrl) {
        // 구버전 노트: pageStrokes 없고 dataUrl만 있는 경우 → 이미지로 표시
        setPages([{ id: 'p1', strokes: [] }]);
        setPageIdx(0);
        strokesRef.current = [];
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { baseImageRef.current = img; redrawBase(); };
        img.src = editingNote.dataUrl;
      } else {
        setPages([{ id: 'p1', strokes: [] }]);
        setPageIdx(0);
        baseImageRef.current = null; strokesRef.current = [];
        redrawBase();
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

    // 검색어가 있으면 해당 keyword가 있는 페이지로 이동 (setTimeout으로 상태 정착 후)
    if (initialSearchQuery && editingNote) {
      const q = initialSearchQuery.toLowerCase();
      // pageOcrTexts 우선, 없으면 pageWordBoxes 텍스트에서 탐색
      let targetIdx = (editingNote.pageOcrTexts ?? []).findIndex(t => t.toLowerCase().includes(q));
      if (targetIdx < 0) {
        targetIdx = (editingNote.pageWordBoxes ?? []).findIndex(
          boxes => boxes.some(b => b.text.toLowerCase().includes(q))
        );
      }
      if (targetIdx > 0) {
        setTimeout(() => {
          goToPageRef.current(targetIdx);
          // 페이지 이동 후 하이라이트: targetIdx를 직접 전달해 stale pageIdx 문제 방지
          setTimeout(() => locateSearchTermRef.current(initialSearchQuery, targetIdx), 350);
        }, 100);
      }
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

  // ocrMsg 자동 숨기기 (5초 후)
  useEffect(() => {
    if (!ocrMsg) return;
    const t = setTimeout(() => setOcrMsg(null), 5000);
    return () => clearTimeout(t);
  }, [ocrMsg]);

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
      if (hlMenuRef.current?.contains(t))      return;
      setShowColorPicker(false); setShowSizePicker(false); setShowHlMenu(false);
      setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false);
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', handler); };
  }, [showPaperMenu, showColorPicker, showSizePicker, showEraserMenu, showPenMenu]);

  // ── Palm rejection + 스와이프 새 페이지 ─────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ① 펜(스타일러스) 입력 추적 — 펜이면 스와이프 비활성화
    const isPenActiveRef = { current: false };
    const onPenDown = (e: PointerEvent) => { if (e.pointerType === 'pen') isPenActiveRef.current = true; };
    const onPenUp   = (e: PointerEvent) => { if (e.pointerType === 'pen') isPenActiveRef.current = false; };
    container.addEventListener('pointerdown', onPenDown, { passive: true });
    container.addEventListener('pointerup',   onPenUp,   { passive: true });
    container.addEventListener('pointercancel', onPenUp, { passive: true });

    // ② 컨테이너 수준에서 터치 분류: 스와이프 vs 팜 vs 핀치 줌
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
      // 1-finger → 스와이프/팜 분류 (펜 입력이면 스와이프 비활성)
      pinchRef.current = null;
      if (isPenActiveRef.current) {
        swipeTouchRef.current = null;
        return;
      }
      const t = e.touches[0];
      // 손바닥 감지: radiusX/radiusY가 크면 팜으로 간주 → 스와이프 무시
      // (손가락은 보통 ~10px, 손바닥은 40px+ 수준)
      if (t.radiusX > 40 || t.radiusY > 40) {
        swipeTouchRef.current = null;
        return;
      }
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
        const containerW = container.offsetWidth || 400;
        const fraction = dx / containerW; // 양수 = 오른쪽(이전), 음수 = 왼쪽(다음)
        const curIdx = live.current.pageIdx;
        const canGoNext = curIdx < pagesLenRef.current - 1;
        const canGoPrev = curIdx > 0;

        // 페이지 이동 방향 → 고무줄 슬라이드 (최대 ±30%)
        if ((dx < 0 && canGoNext) || (dx > 0 && canGoPrev)) {
          const limited = Math.max(-30, Math.min(30, fraction * 100));
          setSlideOffset(limited);
          setSlideActive(false);
        }

        // 새 페이지 추가 힌트 (느린 왼쪽 스와이프, 마지막 페이지)
        if (dx < 0 && !canGoNext) {
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
        const cur = live.current.pageIdx;

        const snapBack = () => {
          setSlideActive(true); setSlideOffset(0);
          setTimeout(() => setSlideActive(false), 180);
        };

        if (absDx > 60) {
          if (elapsed < 400) {
            // ── 빠른 스와이프 → 페이지 이동 (슬라이드 완료 후 전환) ──
            if (dx < 0 && cur < pagesLenRef.current - 1) {
              // 나머지 슬라이드 완료 → 페이지 전환 → 즉시 복귀
              setSlideActive(true); setSlideOffset(-100);
              setTimeout(() => {
                goToPageRef.current(cur + 1);
                setSlideActive(false); setSlideOffset(0);
              }, 120);
            } else if (dx > 0 && cur > 0) {
              setSlideActive(true); setSlideOffset(100);
              setTimeout(() => {
                goToPageRef.current(cur - 1);
                setSlideActive(false); setSlideOffset(0);
              }, 120);
            } else {
              snapBack();
            }
          } else if (dx < -80) {
            // ── 느린 왼쪽 스와이프 → 새 페이지 추가 ──
            addPageRef.current();
            setSwipeProgress(1);
            snapBack();
            setTimeout(() => { setSwipeHint('idle'); setSwipeProgress(0); }, 500);
          } else {
            snapBack();
          }
        } else {
          snapBack();
        }
        setSwipeHint('idle'); setSwipeProgress(0);
      } else {
        setSlideActive(true); setSlideOffset(0);
        setTimeout(() => setSlideActive(false), 180);
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
      container.removeEventListener('pointerdown',   onPenDown);
      container.removeEventListener('pointerup',     onPenUp);
      container.removeEventListener('pointercancel', onPenUp);
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
              fountainIntensity: fi, isEraser: ie, eraserType: et,
              hlOpacity: hlo, hlStraight: hls } = live.current;
      if (pom && e.pointerType === 'touch') return;
      e.preventDefault();
      try { target.setPointerCapture(e.pointerId); } catch {}
      const rect = target.getBoundingClientRect();
      cachedRectRef.current = rect;
      const xfmScale = canvasXformRef.current.scale;
      const p: Point = { x: (e.clientX - rect.left) / xfmScale, y: (e.clientY - rect.top) / xfmScale, pressure: e.pressure > 0 ? e.pressure : 0.5, t: Date.now() };
      isDrawingRef.current = true;
      if (ie) {
        // push undo history once per eraser touch start
        if (!eraserUndoPushedRef.current) {
          const _epid = live.current.pages[live.current.pageIdx]?.id;
          if (_epid) {
            const _eh = undoHistoriesRef.current.get(_epid) ?? [];
            undoHistoriesRef.current.set(_epid, [..._eh, [...strokesRef.current]]);
            redoHistoriesRef.current.delete(_epid);
          }
          eraserUndoPushedRef.current = true;
        }
        handleEraseAt(p, et, ps); return;
      }

      // 형광펜 직선 모드: 시작점 기록
      if (pt === 'highlighter' && hls) hlStartRef.current = { x: p.x, y: p.y, pressure: p.pressure };
      else hlStartRef.current = null;

      const stroke: Stroke = {
        id: `s-${Date.now()}-${Math.random()}`, points: [p], color: pc, size: ps, penType: pt,
        fountainIntensity: fi,
        ...(pt === 'highlighter' ? { opacity: hlo, straight: hls } : {}),
      };
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

        // 형광펜 직선 모드: 시작점→현재점 미리보기만, 포인트 축적 안 함
        if (pt === 'highlighter' && hlStartRef.current) {
          const ac = activeCanvasRef.current;
          if (ac) {
            const ctx = ac.getContext('2d')!;
            ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,ac.width,ac.height); ctx.restore();
            const previewStroke = { ...currentStrokeRef.current, points: [hlStartRef.current, p] };
            appendSegment(ctx, { color: pc, size: ps, penType: pt, fountainIntensity: fi, opacity: live.current.hlOpacity } as Stroke, [hlStartRef.current, p]);
            void previewStroke;
          }
          continue;
        }

        const pts = currentStrokeRef.current.points;
        const prev = pts[pts.length - 1];
        if (prev) { const dx = p.x - prev.x, dy = p.y - prev.y; if (dx*dx + dy*dy < 1.0) continue; }
        // 입력 포인트 EMA 스무딩 — 만년필은 세그먼트가 많을수록 자연스러워서 alpha를 조금 높게
        const isFountain = live.current.penType === 'fountain';
        const alpha = isFountain ? 0.6 : 0.52;
        const smoothed: Point = prev
          ? { x: p.x * alpha + prev.x * (1-alpha), y: p.y * alpha + prev.y * (1-alpha), pressure: p.pressure * 0.5 + prev.pressure * 0.5, t: p.t }
          : p;
        pts.push(smoothed);
        const ac = activeCanvasRef.current;
        if (ac) appendSegment(ac.getContext('2d')!, { color: pc, size: ps, penType: pt, fountainIntensity: fi } as Stroke, pts);
      }
    };

    const onUp = (e: PointerEvent) => {
      const { penOnlyMode: pom, autoReturnPen: arp, pageIdx: ci } = live.current;
      if (pom && e.pointerType === 'touch') return;
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      eraserUndoPushedRef.current = false;
      try { target.releasePointerCapture(e.pointerId); } catch {}
      if (currentStrokeRef.current) {
        let stroke = currentStrokeRef.current;
        // 형광펜 직선: 시작점→끝점 2포인트만 저장
        if (stroke.penType === 'highlighter' && hlStartRef.current && stroke.points.length > 0) {
          const rect2 = cachedRectRef.current || target.getBoundingClientRect();
          const xs = canvasXformRef.current.scale;
          const ep: Point = { x: (e.clientX - rect2.left) / xs, y: (e.clientY - rect2.top) / xs, pressure: 0.5, t: Date.now() };
          stroke = { ...stroke, points: [hlStartRef.current, ep] };
          hlStartRef.current = null;
        }
        // 펜 뗄 때 Laplacian 후처리 스무딩 (형광펜 직선은 제외)
        if (!(stroke.penType === 'highlighter' && stroke.points.length <= 2)) {
          stroke = { ...stroke, points: laplacianSmooth(stroke.points, 2) };
        }
        // undo history push
        const _pid = pages[ci]?.id;
        if (_pid) {
          const _h = undoHistoriesRef.current.get(_pid) ?? [];
          undoHistoriesRef.current.set(_pid, [..._h, [...strokesRef.current]]);
          redoHistoriesRef.current.delete(_pid);
        }
        strokesRef.current.push(stroke);
        setPages(prev => prev.map((pg, i) => i === ci ? { ...pg, strokes: [...strokesRef.current] } : pg));
        currentStrokeRef.current = null;
        // 후처리 스무딩이 적용된 최종 획을 base canvas에 반영
        redrawBase();
        // 자동 저장 (탭 전환 시 손글씨 유지) — 1.5초 디바운스
        if (onAutoSave) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = setTimeout(() => {
            const allStrokes = live.current.pages.map((pg: any, i: number) =>
              i === live.current.pageIdx ? [...strokesRef.current] : [...pg.strokes]
            );
            onAutoSave(live.current.editingNoteId, allStrokes);
          }, 1500);
        }
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


  const handleUndo = useCallback(() => {
    const pageId = pages[pageIdx]?.id;
    if (!pageId) return;
    const history = undoHistoriesRef.current.get(pageId) ?? [];
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    undoHistoriesRef.current.set(pageId, history.slice(0, -1));
    const redo = redoHistoriesRef.current.get(pageId) ?? [];
    redoHistoriesRef.current.set(pageId, [...redo, [...strokesRef.current]]);
    strokesRef.current = [...prev];
    setPages(p => p.map((pg, i) => i === pageIdx ? { ...pg, strokes: [...prev] } : pg));
    redrawBase();
  }, [pageIdx, pages, redrawBase]);

  const handleRedo = useCallback(() => {
    const pageId = pages[pageIdx]?.id;
    if (!pageId) return;
    const redo = redoHistoriesRef.current.get(pageId) ?? [];
    if (redo.length === 0) return;
    const next = redo[redo.length - 1];
    redoHistoriesRef.current.set(pageId, redo.slice(0, -1));
    const history = undoHistoriesRef.current.get(pageId) ?? [];
    undoHistoriesRef.current.set(pageId, [...history, [...strokesRef.current]]);
    strokesRef.current = [...next];
    setPages(p => p.map((pg, i) => i === pageIdx ? { ...pg, strokes: [...next] } : pg));
    redrawBase();
  }, [pageIdx, pages, redrawBase]);

  // ── OCR (Gemini 즉석 인식 버튼용) ──────────────────────────────────────
  const handleOcr = async (customDataUrl?: string) => {
    const dataUrl = customDataUrl || getExportDataUrl();
    if (!dataUrl || strokesRef.current.length === 0) { setOcrMsg('캔버스가 비어있습니다.'); return ''; }
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

  // ── 검색어 위치 찾기 (Gemini 바운딩박스) ────────────────────────────────────
  const locateSearchTerm = useCallback((query: string, pageIdxOverride?: number) => {
    if (!query.trim()) return;
    const q = query.trim().toLowerCase();
    const cvs = baseCanvasRef.current;
    // OCR 당시 저장된 캔버스 크기 우선 사용 → 현재 기기 크기와 달라도 좌표 정확
    const dims = live.current.editingNote?.ocrCanvasDims;
    const W = dims?.w ?? (cvs ? cvs.offsetWidth  : window.innerWidth);
    const H = dims?.h ?? (cvs ? cvs.offsetHeight : window.innerHeight);

    // ── 저장된 WordBox 우선 사용 (오프라인) ─────────────────────────────────
    const pageIdx = pageIdxOverride ?? live.current.pageIdx;
    const storedBoxes = live.current.editingNote?.pageWordBoxes?.[pageIdx] ?? [];
    if (storedBoxes.length > 0) {
      const matched = storedBoxes.filter((b: WordBox) => b.text.toLowerCase().includes(q));

      // 검색어가 여러 단어인 경우 연속 단어 묶음도 시도
      if (matched.length === 0 && q.includes(' ')) {
        const words = q.split(/\s+/);
        const results: WordBox[] = [];
        for (let i = 0; i <= storedBoxes.length - words.length; i++) {
          const chunk = storedBoxes.slice(i, i + words.length);
          const chunkText = chunk.map((b: WordBox) => b.text.toLowerCase()).join(' ');
          if (chunkText.includes(q)) {
            const xs = chunk.map((b: WordBox) => b.x);
            const ys = chunk.map((b: WordBox) => b.y);
            const x2s = chunk.map((b: WordBox) => b.x + b.w);
            const y2s = chunk.map((b: WordBox) => b.y + b.h);
            results.push({
              text: chunk.map((b: WordBox) => b.text).join(' '),
              x: Math.min(...xs), y: Math.min(...ys),
              w: Math.max(...x2s) - Math.min(...xs),
              h: Math.max(...y2s) - Math.min(...ys),
            });
          }
        }
        if (results.length > 0) {
          const PAD = 5;
          setSearchHighlights(results.map((b: WordBox) => ({ x: b.x*W - PAD, y: b.y*H - PAD, w: b.w*W + PAD*2, h: b.h*H + PAD*2 })));
          return;
        }
      }

      if (matched.length > 0) {
        const PAD = 5; // Vision API 허용 오차 보정 여백 (px)
        setSearchHighlights(matched.map((b: WordBox) => ({ x: b.x*W - PAD, y: b.y*H - PAD, w: b.w*W + PAD*2, h: b.h*H + PAD*2 })));
        return;
      }
      setOcrMsg(`🔍 "${query}" 위치 못 찾음 (저장된 OCR 기준)`);
      setSearchHighlights([]);
      return;
    }

    // ── 저장된 박스 없음 → Vision API로 실시간 탐색 (인터넷 필요) ───────────
    setOcrMsg('🔍 저장된 위치 정보 없음. 노트를 다시 저장하면 오프라인으로 작동합니다.');
    setSearchHighlights([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 검색어가 있을 때 자동 위치 탐색 (페이지 로드 후 충분히 지연)
  // editingNote?.id 도 deps에 추가 → 같은 검색어로 다른 노트 열어도 re-trigger
  useEffect(() => {
    if (!initialSearchQuery?.trim()) { setSearchHighlights([]); return; }
    const t = setTimeout(() => locateSearchTerm(initialSearchQuery), 350);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearchQuery, pageIdx, editingNote?.id]);

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
    // 전체 페이지 스트로크 수집 (현재 페이지는 strokesRef로 최신화)
    const allPageStrokes = pages.map((p, i) =>
      i === live.current.pageIdx ? [...strokesRef.current] : p.strokes
    ) as SavedStroke[][];

    // ── 전체 페이지 OCR (Cloud Vision) ──────────────────────────────────────
    const visionApiKey = localStorage.getItem('damoa_vision_api_key') ?? '';
    const pageOcrTexts: string[] = [];
    const pageWordBoxes: WordBox[][] = [];
    const canvasW = containerRef.current?.clientWidth  || 1200;
    const canvasH = containerRef.current?.clientHeight || 1600;

    if (visionApiKey) {
      setIsOcrLoading(true);
      const { extractHandwritingImage, runCloudVisionOcrFull } = await import('../lib/inkOcr');
      const SCALE = 2;

      for (let pi = 0; pi < allPageStrokes.length; pi++) {
        const pgStrokes = allPageStrokes[pi];
        const existingText = editingNote?.pageOcrTexts?.[pi] ?? '';
        const existingBoxes = editingNote?.pageWordBoxes?.[pi] ?? [];
        const shouldRecognize = pgStrokes.length > 0 && (pi === live.current.pageIdx || !existingText);
        if (!shouldRecognize) {
          pageOcrTexts.push(existingText);
          pageWordBoxes.push(existingBoxes);
          continue;
        }
        try {
          setOcrMsg(`🌐 페이지 ${pi + 1}/${allPageStrokes.length} 인식 중...`);
          const imgBase64 = extractHandwritingImage(pgStrokes as any, canvasW, canvasH, SCALE);
          const { text, wordBoxes: wb } = await runCloudVisionOcrFull(imgBase64, visionApiKey, SCALE, canvasW, canvasH);
          pageOcrTexts.push(text || existingText);
          pageWordBoxes.push(wb.map(b => ({ text: b.text, x: b.xFrac, y: b.yFrac, w: b.wFrac, h: b.hFrac })));
        } catch (e) {
          console.warn('[damoa-pen] Cloud Vision 실패:', e);
          pageOcrTexts.push(existingText);
          pageWordBoxes.push(existingBoxes);
        }
      }
      setIsOcrLoading(false);
      const preview = pageOcrTexts.find(t => t?.trim())?.slice(0, 60) ?? '';
      setOcrMsg(preview ? `✅ 인식 완료: "${preview}${preview.length >= 60 ? '...' : ''}"` : null);
    } else {
      // API 키 없으면 기존 텍스트/박스 유지
      for (let pi = 0; pi < allPageStrokes.length; pi++) {
        pageOcrTexts.push(editingNote?.pageOcrTexts?.[pi] ?? '');
        pageWordBoxes.push(editingNote?.pageWordBoxes?.[pi] ?? []);
      }
    }

    // 전체 OCR 텍스트 = 페이지별 합산 (검색용)
    const finalOcr = pageOcrTexts.filter(Boolean).join(' ');
    setOcrText(finalOcr);

    // 태그 파싱
    const finalTags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    if (finalTags.length) setTags(finalTags);
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
      pageOcrTexts.some(Boolean) ? pageOcrTexts : undefined,
      pageWordBoxes.some(b => b.length > 0) ? pageWordBoxes : undefined,
      pageWordBoxes.some(b => b.length > 0) ? { w: canvasW, h: canvasH } : undefined,
    );
  };

  // ── Pages ─────────────────────────────────────────────────────────────────
  const goToPage = (idx: number) => {
    setPageIdx(idx);
    onPageChange?.(idx);
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
    // 햅틱 피드백 (새 페이지 추가 확인)
    try { navigator.vibrate?.(40); } catch {}
    try { (window as any).Capacitor?.Plugins?.Haptics?.impact({ style: 'MEDIUM' }); } catch {}
    const newPg = { id: `p-${pages.length+1}`, strokes: [] as Stroke[] };
    const updated = [...pages, newPg]; setPages(updated);
    const ni = updated.length - 1; setPageIdx(ni);
    strokesRef.current = []; baseImageRef.current = null;
    pageUserImgRef.current = null; // 새 페이지는 사진 없음
    redrawBase(); clearActive();
  };
  addPageRef.current          = addPage;
  goToPageRef.current         = goToPage;
  pagesLenRef.current         = pages.length;
  locateSearchTermRef.current = locateSearchTerm;

  // ── 페이지 전환 슬라이드 애니메이션 ──────────────────────────────────────
  const animatedGoToPage = (idx: number) => {
    if (idx === live.current.pageIdx || pageTransitioning.current) { goToPage(idx); return; }
    pageTransitioning.current = true;
    const dir = idx > live.current.pageIdx ? 1 : -1; // 1 = 다음, -1 = 이전

    // 현재 페이지 슬라이드 아웃
    setSlideActive(true);
    setSlideOffset(dir * -100);

    setTimeout(() => {
      // 페이지 전환 (캔버스 즉시 재렌더)
      goToPage(idx);
      // 반대편에서 나타나도록 순간 이동 (transition 없이)
      setSlideActive(false);
      setSlideOffset(dir * 100);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // 슬라이드 인
          setSlideActive(true);
          setSlideOffset(0);
          setTimeout(() => {
            pageTransitioning.current = false;
            setSlideActive(false);
          }, 200);
        });
      });
    }, 150);
  };
  animatedGoToPageRef.current = animatedGoToPage;

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
      pdfCacheRef.current.forEach(bmp => bmp.close());
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

      // ⑥ 다음 4페이지만 백그라운드 프리렌더 (메모리 절약 — LRU 캐시가 나머지 처리)
      setTimeout(async () => {
        const prefetchEnd = Math.min(5, pdf.numPages);
        for (let i = 1; i < prefetchEnd; i++) {
          setPdfRenderMsg(`미리 렌더 ${i + 1}/${pdf.numPages}`);
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
        <div className="relative">
          <div className="flex items-center bg-stone-200 dark:bg-slate-900 border-b border-stone-300 dark:border-slate-700 overflow-x-auto"
            style={{touchAction:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch'}}>
            {openTabs.map((tab, i) => (
              <div key={i} className="relative shrink-0">
                <div
                  className={`flex items-center gap-1 px-2 py-1.5 text-xs font-bold cursor-pointer border-b-2 transition-colors select-none ${i === activeTabIdxProp ? 'bg-stone-100 dark:bg-slate-800 border-purple-500 text-stone-900 dark:text-white' : 'border-transparent text-stone-500 dark:text-slate-400 hover:bg-stone-100/60 dark:hover:bg-slate-800/60'}`}
                  onClick={() => { onTabSwitch?.(i); }}
                  onPointerDown={e => {
                    const t = setTimeout(() => { onTabEdit?.(i); }, 500);
                    (e.currentTarget as any)._longPressTimer = t;
                  }}
                  onPointerUp={e => { clearTimeout((e.currentTarget as any)._longPressTimer); }}
                  onPointerLeave={e => { clearTimeout((e.currentTarget as any)._longPressTimer); }}
                  onPointerCancel={e => { clearTimeout((e.currentTarget as any)._longPressTimer); }}>
                  {/* 색상 점 (표시용) */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/40"
                    style={{background: tab.color}}
                  />
                  {/* 제목 */}
                  <span className="max-w-[80px] truncate">{tab.title}</span>
                  {/* 닫기 */}
                  <button type="button"
                    className="ml-0.5 text-stone-400 hover:text-red-400 cursor-pointer"
                    onClick={e => { e.stopPropagation(); onTabClose?.(i); }}>
                    <X className="w-3 h-3"/>
                  </button>
                </div>

                {/* 탭 편집 팝업 */}
                {tabEditIdx === i && (
                  <div className="absolute top-full left-0 z-50 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl shadow-2xl p-3 min-w-[200px]"
                    style={{touchAction:'auto'}}
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}>
                    {/* 제목 입력 */}
                    <div className="mb-2.5">
                      <div className="text-[10px] font-black text-stone-400 mb-1 uppercase tracking-wider">탭 제목</div>
                      <input
                        type="text"
                        value={tab.title}
                        onChange={e => onTabTitleChange?.(i, e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-800 dark:text-slate-200 outline-none border border-transparent focus:border-purple-400"
                        style={{touchAction:'auto'}}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    {/* 색상 팔레트 */}
                    <div>
                      <div className="text-[10px] font-black text-stone-400 mb-1.5 uppercase tracking-wider">탭 색상</div>
                      <div className="flex gap-1.5 flex-wrap">
                        {['#8b5cf6','#22c55e','#3b82f6','#f97316','#ec4899','#14b8a6','#ef4444','#eab308','#06b6d4','#a855f7'].map(c => (
                          <button key={c} type="button"
                            onClick={() => onTabColorSet?.(i, c)}
                            className={`w-6 h-6 rounded-full cursor-pointer border-2 transition-transform ${tab.color===c?'border-stone-800 dark:border-white scale-110':'border-transparent'}`}
                            style={{background:c}}/>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {/* 새 탭 */}
            <button type="button" title="새 노트 탭"
              onClick={onNewTab}
              className="flex items-center justify-center px-2 py-1.5 text-stone-400 dark:text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 cursor-pointer shrink-0">
              <Plus className="w-3.5 h-3.5"/>
            </button>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      {/* touch-action:auto so stylus can tap inputs on tablet */}
      <div className="px-2 py-2 border-b border-white/10 relative z-30 space-y-1.5"
        style={{touchAction:'auto', background:'rgba(22,20,18,0.97)'}}>

        {/* Row 1: back / title / page nav / collapse / save */}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onBack}
            className="px-2 py-1 bg-white/10 border border-white/15 rounded-lg font-black text-xs flex items-center gap-1 text-white/75 cursor-pointer hover:bg-white/15">
            <ChevronLeft className="w-3.5 h-3.5 text-purple-400"/>
            <span className="hidden sm:inline">목록</span>
          </button>

          {/* Title — explicit pointer-events + stop propagation so stylus works */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="제목 (선택사항)"
            inputMode="text"
            className="flex-1 min-w-0 text-sm font-bold bg-transparent outline-none text-white/90 placeholder-white/25 px-1 py-1"
            style={{touchAction:'auto', pointerEvents:'auto', userSelect:'text', WebkitUserSelect:'text'} as React.CSSProperties}
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          />

          {/* Page nav */}
          <div className="flex items-center bg-white/10 border border-white/15 rounded-xl px-1.5 py-1 gap-1"
            style={{touchAction:'auto'}}>
            <button type="button" disabled={pageIdx===0} onClick={() => animatedGoToPage(pageIdx-1)}
              className="p-0.5 disabled:opacity-30 hover:bg-white/10 rounded cursor-pointer">
              <ChevronLeft className="w-3.5 h-3.5 text-purple-400"/>
            </button>
            <span className="text-[11px] font-black text-white/80">{pageIdx+1}/{pages.length}</span>
            <button type="button" onClick={() => pageIdx<pages.length-1?animatedGoToPage(pageIdx+1):addPage()}
              className="p-0.5 hover:bg-white/10 rounded cursor-pointer">
              <ChevronRight className="w-3.5 h-3.5 text-purple-400"/>
            </button>
          </div>

          {/* ── 줌 잠금 (Row 1 — 항상 노출) ── */}
          {(zoomEnabled || zoomLocked) && (
            <button type="button" title={zoomLocked ? '줌 잠금 해제' : '현재 배율 고정'}
              onClick={() => {
                if (zoomLocked) {
                  setZoomLocked(false);
                  const id = { scale: 1, x: 0, y: 0 };
                  canvasXformRef.current = id; setCanvasXform(id);
                  cachedRectRef.current = null;
                } else { setZoomLocked(true); }
              }}
              className={`px-2 py-1.5 rounded-xl flex items-center cursor-pointer shrink-0 border ${zoomLocked?'bg-amber-500/25 border-amber-400/50 text-amber-300':'bg-white/10 border-white/15 text-white/50'}`}>
              {zoomLocked ? <Lock className="w-3.5 h-3.5"/> : <Unlock className="w-3.5 h-3.5"/>}
            </button>
          )}

          {/* ── PDF 반전 (Row 1 — 항상 노출) ── */}
          {pdfBase64 && (
            <button type="button" title={pdfInvert ? 'PDF 반전 끄기' : 'PDF 반전 (야간)'}
              onClick={() => setPdfInvert(v => !v)}
              className={`px-2 py-1.5 rounded-xl flex items-center cursor-pointer shrink-0 border text-sm leading-none ${pdfInvert?'bg-indigo-600/50 border-indigo-500/50 text-white':'bg-white/10 border-white/15 text-white/60'}`}>
              🌙
            </button>
          )}

          <button type="button" onClick={() => setToolbarCollapsed(!toolbarCollapsed)}
            className="flex items-center gap-1 px-2 py-1.5 bg-white/10 border border-white/15 rounded-xl text-xs font-black cursor-pointer text-white/60 hover:bg-white/15">
            {toolbarCollapsed ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronUp className="w-3.5 h-3.5"/>}
          </button>

          <button type="button" onClick={handleSave}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1 shadow-md cursor-pointer active:scale-95">
            <Check className="w-4 h-4"/><span>저장</span>
          </button>
        </div>

        {/* Row 2: pen tools (flat icon-only) */}
        <div className={`${toolbarCollapsed?'hidden':'flex'} items-center gap-0 flex-wrap`}>

          {/* ── Pen type selector ── */}
          <div className="relative">
            <button type="button" title={PEN_LABELS[penType]}
              onClick={() => { setShowPenMenu(!showPenMenu); setShowColorPicker(false); setShowSizePicker(false); setShowEraserMenu(false); setShowPaperMenu(false); setShowSettingsPanel(false); }}
              className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 flex items-center gap-0.5 ${isEraser?'text-white/40 hover:text-white/75':'text-white'}`}>
              <span className="text-base leading-none">{PEN_ICONS[penType]}</span>
              <span className="text-[8px] opacity-40">▾</span>
            </button>
            {showPenMenu && (
              <div ref={penMenuRef} className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl p-1.5 shadow-xl z-50 min-w-[160px] flex flex-col gap-1">
                {(['pen','penFountain','fountain','highlighter'] as PenType[]).map(pt => (
                  <button key={pt} type="button"
                    onClick={() => {
                      setPenType(pt);
                      // penFountain으로 전환 시 기본 강도 '약'(0.5) 설정
                      if (pt === 'penFountain' && fountainIntensity > 2.0) setFountainIntensity(0.5);
                      setIsEraser(false); setShowPenMenu(false);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-black text-left flex items-center gap-2 cursor-pointer ${penType===pt&&!isEraser?'bg-purple-600 text-white':'text-stone-800 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'}`}>
                    <span>{PEN_ICONS[pt]}</span><span>{PEN_LABELS[pt]}</span>
                  </button>
                ))}
                {/* 볼펜+만년필 획끝 강도 */}
                {penType === 'penFountain' && (
                  <div className="px-3 py-2 border-t border-stone-100 dark:border-slate-700 mt-1">
                    <div className="text-[10px] font-black text-stone-500 mb-1.5">획끝 강도</div>
                    <div className="flex gap-1">
                      {([{label:'없음',val:0},{label:'약',val:0.5},{label:'중',val:1.0},{label:'강',val:2.0}] as {label:string;val:number}[]).map(({label,val}) => (
                        <button key={label} type="button"
                          onClick={() => setFountainIntensity(val)}
                          className={`flex-1 py-1 rounded-lg text-[10px] font-black cursor-pointer ${Math.abs(fountainIntensity-val)<0.01?'bg-purple-600 text-white':'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                {/* Highlighter settings */}
                {penType === 'highlighter' && (
                  <div className="px-3 py-2 border-t border-stone-100 dark:border-slate-700 mt-1 flex flex-col gap-2">
                    <div>
                      <div className="text-[10px] font-black text-stone-500 mb-1.5">투명도</div>
                      <div className="flex gap-1">
                        {[{label:'연하게',val:0.20},{label:'보통',val:0.38},{label:'진하게',val:0.60}].map(({label,val}) => (
                          <button key={label} type="button"
                            onClick={() => { setHlOpacity(val); live.current.hlOpacity = val; }}
                            className={`flex-1 py-1 rounded-lg text-[10px] font-black cursor-pointer ${Math.abs(hlOpacity-val)<0.05?'bg-yellow-400 text-stone-900':'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-stone-500">직선 모드</span>
                      <button type="button"
                        onClick={() => { setHlStraight(v => !v); live.current.hlStraight = !hlStraight; }}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black cursor-pointer ${hlStraight?'bg-yellow-400 text-stone-900':'bg-stone-200 dark:bg-slate-700 text-stone-600 dark:text-slate-300'}`}>
                        {hlStraight?'ON':'OFF'}
                      </button>
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
              className="px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 flex items-center gap-0.5 hover:opacity-90">
              <span className="w-5 h-5 rounded-full shrink-0"
                style={{backgroundColor: isEraser ? '#9ca3af' : penColor, opacity: isHL ? 0.6 : 1, outline: '2px solid rgba(255,255,255,0.25)', outlineOffset:'1px'}}/>
              <span className="text-[8px] text-white/25">▾</span>
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
              className="px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 flex items-center gap-0.5 text-white/50 hover:text-white/90">
              <svg width="18" height="14" viewBox="0 0 18 14" fill="currentColor" aria-hidden="true">
                <rect x="0" y="0" width="18" height="1.5" rx="0.75"/>
                <rect x="0" y="5" width="18" height="2.5" rx="1.25"/>
                <rect x="0" y="10.5" width="18" height="3" rx="1.5" opacity="0.6"/>
              </svg>
              <span className="text-[8px] text-white/25">▾</span>
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
            <div className="flex items-center">
              <button type="button" title={isEraser?(eraserType==='stroke'?'획지우개':'부분지우개'):'지우개'}
                onClick={() => { setIsEraser(!isEraser); setShowEraserMenu(false); }}
                className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 ${isEraser?'text-white':'text-white/40 hover:text-white/80'}`}>
                <Eraser className="w-4 h-4"/>
              </button>
              <button type="button"
                onClick={() => { setShowEraserMenu(!showEraserMenu); setShowColorPicker(false); setShowSizePicker(false); setShowPenMenu(false); setShowPaperMenu(false); setShowSettingsPanel(false); }}
                className="text-[8px] text-white/25 cursor-pointer hover:text-white/60 pr-1">▾</button>
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

          <div className="w-px h-4 bg-white/15 mx-1 shrink-0"/>

          {/* ── 종이 설정 (Settings 패널 토글) ── */}
          <button type="button" title="종이 설정"
            onClick={() => { setShowSettingsPanel(!showSettingsPanel); setShowColorPicker(false); setShowSizePicker(false); setShowPenMenu(false); setShowEraserMenu(false); setShowPaperMenu(false); }}
            className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 ${showSettingsPanel?'opacity-100':'opacity-40 hover:opacity-80'}`}>
            <span className="text-base leading-none">{paperType==='black'?'🖤':paperType==='yellow'?'📒':'📄'}</span>
          </button>

          {/* ── Palm rejection ── */}
          <button type="button" title={penOnlyMode ? '펜 전용 (터치 차단)' : '터치+펜 허용'}
            onClick={() => setPenOnlyMode(!penOnlyMode)}
            className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 ${penOnlyMode?'text-white':'text-white/40 hover:text-white/80'}`}>
            <Hand className="w-4 h-4"/>
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
            className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 flex items-center gap-0.5 ${zoomEnabled?'text-white':'text-white/40 hover:text-white/80'}`}>
            <Search className="w-4 h-4"/>
            {canvasXform.scale !== 1 && (
              <span className="text-[10px] font-black">{Math.round(canvasXform.scale*100)}%</span>
            )}
          </button>

          <div className="w-px h-4 bg-white/15 mx-1 shrink-0"/>

          {/* ── Undo ── */}
          <button type="button" title="실행 취소" onClick={handleUndo}
            className="px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 text-white/40 hover:text-white/80">
            <Undo2 className="w-4 h-4"/>
          </button>

          {/* ── Redo ── */}
          <button type="button" title="다시 실행" onClick={handleRedo}
            className="px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 text-white/40 hover:text-white/80">
            <Redo2 className="w-4 h-4"/>
          </button>

          <div className="w-px h-4 bg-white/15 mx-1 shrink-0"/>

          {/* ── OCR ── */}
          <button type="button" title={isOcrLoading ? '판독 중...' : ocrText ? 'AI 완료' : 'AI 인식'}
            disabled={isOcrLoading} onClick={() => handleOcr()}
            className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 disabled:opacity-40 ${isOcrLoading?'text-purple-400 animate-pulse':ocrText?'text-white':'text-white/40 hover:text-white/80'}`}>
            <Sparkles className="w-4 h-4"/>
          </button>

          {/* ── PDF 임포트 ── */}
          <button type="button" title={loadingPdf ? 'PDF 로딩...' : pdfBase64 ? 'PDF 첨부됨' : 'PDF 첨부'}
            disabled={loadingPdf}
            onClick={() => pdfInputRef.current?.click()}
            className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 disabled:opacity-40 relative ${pdfBase64?'text-white':'text-white/40 hover:text-white/80'}`}>
            <FileText className="w-4 h-4"/>
            {pdfBase64 && <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400"/>}
          </button>
          <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = ''; }}/>

          {/* PDF 반전은 Row 1로 이동 */}

          {/* ── 사진 첨부 ── */}
          <div className="flex items-center gap-0.5">
            <button type="button" title={pageImages[pageIdx] ? '사진 첨부됨' : '사진 첨부'}
              onClick={() => imgInputRef.current?.click()}
              className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 relative ${pageImages[pageIdx]?'text-white':'text-white/40 hover:text-white/80'}`}>
              <ImageIcon className="w-4 h-4"/>
              {pageImages[pageIdx] && <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400"/>}
            </button>
            {pageImages[pageIdx] && (
              <button type="button" title="사진 제거" onClick={removePageImage}
                className="text-white/30 hover:text-red-400 cursor-pointer active:scale-95 p-0.5">
                <X className="w-3.5 h-3.5"/>
              </button>
            )}
          </div>
          <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importImage(f); e.target.value = ''; }}/>

          {/* ── 노트 정보 (태그/폴더) ── */}
          <button type="button" title="태그/폴더"
            onClick={() => setShowNoteInfo(!showNoteInfo)}
            className={`px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 ${showNoteInfo?'text-white':'text-white/40 hover:text-white/80'}`}>
            <Tag className="w-4 h-4"/>
          </button>

          {/* ── 페이지 병합 ── */}
          {allNotes && allNotes.length > 1 && (
            <>
              <div className="w-px h-4 bg-white/15 mx-1 shrink-0"/>
              <button type="button" title="페이지 병합"
                onClick={() => {
                  setMergeSelPages([pageIdx]);
                  setMergeTargetNote(allNotes.find(n => n.id !== editingNote?.id)?.id ?? '');
                  setMergeInsertAfter(-1);
                  setShowMergeModal(true);
                }}
                className="px-1.5 py-1.5 cursor-pointer active:scale-95 shrink-0 text-white/40 hover:text-white/80">
                {/* two overlapping pages icon */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="9" height="11" rx="1.5"/>
                  <path d="M5 4V2.5A1.5 1.5 0 0 1 6.5 1h8A1.5 1.5 0 0 1 16 2.5v9A1.5 1.5 0 0 1 14.5 13H12" strokeWidth="1.3"/>
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Row 2.5: 종이 설정 패널 */}
        {showSettingsPanel && (
          <div className="mt-1 border-t border-white/10 pt-2 flex flex-col gap-2.5">
            {/* 종이 색상 */}
            <div>
              <div className="text-[10px] font-black text-white/40 mb-1.5 uppercase tracking-wider">종이 색상</div>
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
                <div className="text-[10px] font-black text-white/40 uppercase tracking-wider">줄 표시</div>
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
        {/* 페이지 전환 슬라이드 wrapper */}
        <div style={{
          position: 'absolute', inset: 0,
          transform: `translateX(${slideOffset}%)`,
          transition: slideActive ? 'transform 0.15s ease-out' : 'none',
        }}>
        {/* 줌/패닝 wrapper — CSS transform으로 확대/축소 처리, 캔버스 자체 해상도는 불변 */}
        <div ref={canvasWrapRef} className="absolute inset-0"
          style={{
            touchAction: 'none',
            transform: `translate(${canvasXform.x}px,${canvasXform.y}px) scale(${canvasXform.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
            filter: pdfInvert ? 'invert(1) hue-rotate(180deg)' : undefined,
          }}>
          <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full block"
            style={{touchAction:'none', userSelect:'none', willChange:'transform'}}/>
          <canvas ref={activeCanvasRef} className="absolute inset-0 w-full h-full block"
            style={{touchAction:'none', userSelect:'none', willChange:'transform', background:'transparent'}}/>
          {/* ── 검색어 하이라이트 오버레이 ── */}
          {searchHighlights.map((box, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: box.x, top: box.y, width: box.w, height: box.h,
              background: 'rgba(59,130,246,0.12)',
              border: '2px solid rgba(59,130,246,0.9)',
              borderRadius: '4px',
              pointerEvents: 'none',
              zIndex: 8,
            }}/>
          ))}
          {/* ── 검색 위치 탐색 중 표시 ── */}
          {locatingSearch && (
            <div style={{position:'absolute',bottom:8,right:8,zIndex:20,background:'rgba(124,58,237,0.85)',color:'#fff',borderRadius:12,padding:'4px 10px',fontSize:11,fontWeight:700,pointerEvents:'none'}}>
              🔍 검색 위치 탐색 중...
            </div>
          )}
        </div>
        </div>{/* /페이지 전환 슬라이드 wrapper */}

        {/* ── 스와이프 새 페이지 힌트 ── */}
        {/* OCR 메시지 — 절대 위치 오버레이 (레이아웃 영향 없음) */}
        {ocrMsg && (
          <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-auto"
            style={{animation:'fadeIn 0.2s ease'}}>
            <div className="px-3 py-2 rounded-2xl shadow-lg flex items-center justify-between gap-2 text-xs font-bold"
              style={{background:'rgba(124,58,237,0.92)', backdropFilter:'blur(8px)', color:'#fff'}}>
              <span className="truncate">{ocrMsg}</span>
              <button type="button" onClick={() => setOcrMsg(null)} className="text-white/70 hover:text-white font-black cursor-pointer shrink-0 text-sm">✕</button>
            </div>
          </div>
        )}

        {/* ── 페이지 병합 모달 ── */}
        {showMergeModal && allNotes && (
          <div className="absolute inset-0 z-50 flex items-center justify-center"
            style={{background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)'}}>
            <div className="bg-zinc-900 rounded-2xl p-5 w-80 max-w-[92vw] flex flex-col gap-4 shadow-2xl border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-white font-black text-sm">페이지 병합</span>
                <button type="button" onClick={() => setShowMergeModal(false)}
                  className="text-white/40 hover:text-white cursor-pointer">
                  <X className="w-4 h-4"/>
                </button>
              </div>

              {/* 원본 페이지 선택 */}
              <div>
                <div className="text-[10px] font-black text-white/40 uppercase tracking-wider mb-2">이동할 페이지 선택</div>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {pages.map((_, i) => (
                    <button key={i} type="button"
                      onClick={() => setMergeSelPages(sel =>
                        sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i].sort((a,b) => a-b)
                      )}
                      className={`w-9 h-9 rounded-lg text-xs font-black cursor-pointer active:scale-95 transition-colors ${
                        mergeSelPages.includes(i)
                          ? 'bg-purple-600 text-white'
                          : 'bg-white/10 text-white/50 hover:bg-white/20'
                      }`}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>

              {/* 대상 노트 선택 */}
              <div>
                <div className="text-[10px] font-black text-white/40 uppercase tracking-wider mb-2">대상 노트</div>
                <select value={mergeTargetNote} onChange={e => setMergeTargetNote(e.target.value)}
                  className="w-full bg-white/10 text-white text-xs rounded-lg px-3 py-2 border border-white/15 outline-none cursor-pointer">
                  {allNotes.filter(n => n.id !== editingNote?.id).map(n => (
                    <option key={n.id} value={n.id} style={{background:'#1a1a1a'}}>
                      {n.title || '(제목 없음)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* 삽입 위치 */}
              <div>
                <div className="text-[10px] font-black text-white/40 uppercase tracking-wider mb-2">삽입 위치</div>
                {(() => {
                  const targetNote = allNotes.find(n => n.id === mergeTargetNote);
                  const targetPageCount = targetNote?.pageStrokes?.length ?? 1;
                  return (
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      <button type="button"
                        onClick={() => setMergeInsertAfter(-1)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer active:scale-95 transition-colors ${
                          mergeInsertAfter === -1
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/10 text-white/50 hover:bg-white/20'
                        }`}>
                        맨 앞
                      </button>
                      {Array.from({length: targetPageCount}, (_, i) => (
                        <button key={i} type="button"
                          onClick={() => setMergeInsertAfter(i)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer active:scale-95 transition-colors ${
                            mergeInsertAfter === i
                              ? 'bg-blue-600 text-white'
                              : 'bg-white/10 text-white/50 hover:bg-white/20'
                          }`}>
                          {i + 1}p 뒤
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* 확인 버튼 */}
              <button type="button"
                disabled={mergeSelPages.length === 0 || !mergeTargetNote || mergeLoading}
                onClick={async () => {
                  if (!onMergePages || mergeSelPages.length === 0 || !mergeTargetNote) return;
                  setMergeLoading(true);
                  try {
                    await onMergePages(mergeSelPages, mergeTargetNote, mergeInsertAfter);
                    setShowMergeModal(false);
                  } finally {
                    setMergeLoading(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl text-sm font-black cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                style={{background: mergeSelPages.length > 0 && mergeTargetNote ? 'rgba(124,58,237,0.9)' : undefined, color:'#fff'}}>
                {mergeLoading ? '이동 중...' : `${mergeSelPages.length}페이지 이동`}
              </button>
            </div>
          </div>
        )}

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


    </div>
  );
};
