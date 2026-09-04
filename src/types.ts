// ── 공유 타입 ─────────────────────────────────────────────────────────────────

export type PenType = 'pen' | 'fountain' | 'highlighter';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  t?: number;
}

/** 직렬화 가능한 스트로크 (IndexedDB 저장용) */
export interface SavedStroke {
  id: string;
  points: StrokePoint[];
  color: string;
  size: number;
  penType: PenType;
  fountainIntensity: number;
}

// ── 노트 ──────────────────────────────────────────────────────────────────────

export interface PenNote {
  id: string;
  title: string;
  dataUrl: string;          // 현재 페이지 JPEG 썸네일
  ocrText: string;          // 손글씨 인식 텍스트 (검색용)
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  paperType: 'white' | 'yellow' | 'black';
  folderId?: string;
  tags?: string[];

  // ── PDF 원본 방식 ──────────────────────────────────────────────────────────
  pdfBase64?: string;       // PDF 원본 파일 (base64)
  pdfText?: string;         // PDF 전체 텍스트 (검색용, getTextContent 추출)
  pdfPageCount?: number;    // PDF 총 페이지 수
  pageStrokes?: SavedStroke[][];          // 페이지별 손글씨 스트로크
  penSettings?: PenSettings;             // 마지막 사용 펜 설정 (노트별 저장/복원)
  pageImages?: (string | undefined)[];   // 페이지별 첨부 사진 (base64 JPEG)
  tabColor?: string;                     // 탭 색상
  pageOcrTexts?: string[];               // 페이지별 OCR 텍스트 (검색 → 페이지 이동용)
  pageWordBoxes?: WordBox[][];           // 페이지별 단어 바운딩 박스 (오프라인 검색 하이라이트용)
  ocrCanvasDims?: { w: number; h: number }; // OCR 당시 캔버스 CSS 픽셀 크기 (좌표 정확도용)
}

/** 단어 바운딩 박스 — 좌표는 캔버스 CSS 픽셀 비율 (0.0~1.0) */
export interface WordBox {
  text: string;
  x: number; // 왼쪽 (캔버스 width 비율)
  y: number; // 위쪽 (캔버스 height 비율)
  w: number; // 너비 (캔버스 width 비율)
  h: number; // 높이 (캔버스 height 비율)
}

// ── 펜 설정 ───────────────────────────────────────────────────────────────────

export interface PenSettings {
  penType: PenType;
  penSize: number;
  penColor: string;
  fountainIntensity: number;
}

// ── 폴더 ──────────────────────────────────────────────────────────────────────

export interface Folder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}
