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
  pageStrokes?: SavedStroke[][];  // 페이지별 손글씨 스트로크
}

// ── 폴더 ──────────────────────────────────────────────────────────────────────

export interface Folder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}
