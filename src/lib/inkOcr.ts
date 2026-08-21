/**
 * ML Kit Digital Ink Recognition — 오프라인 한글 손글씨 인식
 *
 * 개선 사항:
 *  1. 좌표 정규화 (0~1000 범위) — ML Kit 권장 스케일
 *  2. 스트로크를 y좌표 기준 행(line) 그룹으로 분리 → 행별 인식 후 합산
 *  3. 행 간 타임스탬프 갭(2 s) 부여 → 단어/문장 경계 인식률 향상
 *  4. 하이라이터(형광펜) 스트로크 제외
 */

export interface InkPoint  { x: number; y: number; t: number; }
export interface InkStroke { points: InkPoint[]; }

function getInkPlugin(): any {
  const cap = (window as any).Capacitor;
  if (!cap) throw new Error('Capacitor를 찾을 수 없습니다. 네이티브 앱에서 실행하세요.');
  const plugin = cap.Plugins?.InkRecognition;
  if (!plugin) throw new Error('InkRecognition 플러그인이 없습니다. APK를 최신 버전으로 업데이트하세요.');
  return plugin;
}

// ── 좌표 정규화 ──────────────────────────────────────────────────────────────
function normalizeStrokes(
  strokes: InkStroke[],
  targetMax = 1000,
): InkStroke[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale  = targetMax / Math.max(rangeX, rangeY);
  return strokes.map(s => ({
    points: s.points.map(p => ({
      x: (p.x - minX) * scale,
      y: (p.y - minY) * scale,
      t: p.t,
    })),
  }));
}

// ── y좌표 기준 행(line) 클러스터링 ──────────────────────────────────────────
function clusterByLine(
  strokes: InkStroke[],
  lineGap: number,           // 같은 행으로 볼 y 거리 (정규화 후 기준)
): InkStroke[][] {
  if (strokes.length === 0) return [];

  // 각 스트로크의 y 중심 계산
  const withY = strokes.map(s => {
    const ys = s.points.map(p => p.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { s, midY };
  });

  // midY 기준 정렬
  withY.sort((a, b) => a.midY - b.midY);

  const lines: InkStroke[][] = [];
  let curLine: InkStroke[] = [withY[0].s];
  let lineBaseY = withY[0].midY;

  for (let i = 1; i < withY.length; i++) {
    if (withY[i].midY - lineBaseY > lineGap) {
      lines.push(curLine);
      curLine = [withY[i].s];
      lineBaseY = withY[i].midY;
    } else {
      curLine.push(withY[i].s);
    }
  }
  lines.push(curLine);
  return lines;
}

// ── 행 내 스트로크에 연속 타임스탬프 부여 ──────────────────────────────────
function assignTimestamps(
  lines: InkStroke[][],
  msPerPoint = 16,
  msGapInLine = 300,
  msGapBetweenLines = 2000,
): InkStroke[][] {
  let t = 0;
  return lines.map(line => {
    // 행 내 스트로크를 x 중심 기준으로 정렬 (왼→오)
    const sorted = [...line].sort((a, b) => {
      const ax = a.points.reduce((s, p) => s + p.x, 0) / (a.points.length || 1);
      const bx = b.points.reduce((s, p) => s + p.x, 0) / (b.points.length || 1);
      return ax - bx;
    });
    const timed = sorted.map(s => {
      const pts = s.points.map((p, i) => ({ ...p, t: t + i * msPerPoint }));
      t += s.points.length * msPerPoint + msGapInLine;
      return { points: pts };
    });
    t += msGapBetweenLines;
    return timed;
  });
}

// ── 단일 배치 인식 ────────────────────────────────────────────────────────────
async function recognizeBatch(
  plugin: any,
  strokes: InkStroke[],
  languageCode: string,
): Promise<string> {
  if (strokes.length === 0) return '';
  const result = await plugin.recognize({ strokes, languageCode });
  return (result?.text ?? '').trim();
}

/**
 * 손글씨 스트로크 → 한글 텍스트
 *
 * @param rawStrokes  PenCanvas 스트로크 배열 (원본 좌표)
 * @param languageCode  기본 'ko-KR'
 */
export async function runInkOcr(
  rawStrokes: Array<{
    points: Array<{ x: number; y: number; pressure: number; t?: number }>;
    penType?: string;
  }>,
  languageCode = 'ko-KR',
): Promise<string> {
  const plugin = getInkPlugin();

  // 형광펜(highlighter) 제외
  const filtered = rawStrokes.filter(s =>
    s.points.length >= 2 && s.penType !== 'highlighter'
  );
  if (filtered.length === 0) return '';

  // InkStroke 형식으로 변환
  const inkStrokes: InkStroke[] = filtered.map((s, si) => ({
    points: s.points.map((p, pi) => ({
      x: p.x,
      y: p.y,
      t: p.t ?? (si * 1200 + pi * 16),
    })),
  }));

  // 1. 정규화 (0~1000)
  const normalized = normalizeStrokes(inkStrokes);

  // 2. 행 클러스터링 (lineGap = 정규화 후 약 80)
  const lineGap = 80;
  const lines = clusterByLine(normalized, lineGap);

  // 3. 타임스탬프 재부여
  const timedLines = assignTimestamps(lines);

  // 4. 행 수에 따라 배치 방식 결정
  //    - 5행 이하: 전체 한꺼번에 → 문맥 활용으로 정확도↑
  //    - 6행 초과: 3행씩 묶어서 인식 후 합산 → API 부하↓
  const BATCH_SIZE = 3;
  const texts: string[] = [];

  if (lines.length <= 5) {
    const flat = timedLines.flat();
    const text = await recognizeBatch(plugin, flat, languageCode);
    texts.push(text);
  } else {
    for (let i = 0; i < timedLines.length; i += BATCH_SIZE) {
      const batch = timedLines.slice(i, i + BATCH_SIZE).flat();
      const text  = await recognizeBatch(plugin, batch, languageCode);
      if (text) texts.push(text);
    }
  }

  return texts.filter(Boolean).join('\n');
}

/**
 * ML Kit Korean Text Recognition (이미지 기반, 오프라인)
 * extractHandwritingImage()로 만든 base64 JPEG를 네이티브 플러그인에 전달해 텍스트 추출.
 */
export async function runMlKitImageOcr(
  imageBase64: string,
): Promise<string> {
  const plugin = getInkPlugin();
  const result = await plugin.recognizeImage({ imageBase64 });
  return (result?.text ?? '').trim();
}

/**
 * 한국어 디지털 잉크 모델 미리 다운로드
 */
export async function downloadInkModel(languageCode = 'ko-KR'): Promise<void> {
  const plugin = getInkPlugin();
  await plugin.downloadModel({ languageCode });
}

// ── 이미지 기반 OCR (Google Cloud Vision) ────────────────────────────────────

export interface StrokeForImage {
  points: Array<{ x: number; y: number; pressure: number; t?: number }>;
  color: string;
  size: number;
  penType?: string;
  opacity?: number;
}

/**
 * 손글씨 스트로크만 흰 배경 캔버스에 그려 JPEG base64 반환.
 * PDF 배경·종이색·줄은 제외 → OCR 노이즈 최소화.
 * 형광펜(highlighter) 제외 옵션 적용.
 */
export function extractHandwritingImage(
  strokes: StrokeForImage[],
  canvasW = 1200,
  canvasH = 1600,
  scale = 2, // 업스케일 — Cloud Vision 인식률 향상
): string {
  const c = document.createElement('canvas');
  c.width  = canvasW * scale;
  c.height = canvasH * scale;
  const ctx = c.getContext('2d')!;

  // 흰 배경
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);

  // 좌표·선 굵기 2배 스케일
  ctx.scale(scale, scale);

  // 형광펜 제외, 나머지 스트로크 그리기
  for (const s of strokes) {
    if (s.penType === 'highlighter') continue;
    if (s.points.length < 2) continue;

    ctx.beginPath();
    ctx.strokeStyle = '#000000'; // 흑색 고정 — OCR 인식률 최대화
    ctx.lineWidth   = Math.max(2, s.size); // 최소 2px 보장
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = 1;

    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return c.toDataURL('image/jpeg', 0.95).replace(/^data:image\/jpeg;base64,/, '');
}

/**
 * Google Cloud Vision API로 손글씨 이미지 인식.
 * DOCUMENT_TEXT_DETECTION 모드: 문서/손글씨에 최적화.
 */
export async function runCloudVisionOcr(
  imageBase64: string,
  apiKey: string,
): Promise<string> {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const body = {
    requests: [{
      image: { content: imageBase64 },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
      imageContext: { languageHints: ['ko', 'en'] },
    }],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cloud Vision HTTP ${res.status}`);
  const data = await res.json();
  const text = data.responses?.[0]?.fullTextAnnotation?.text ?? '';
  return text.trim();
}
