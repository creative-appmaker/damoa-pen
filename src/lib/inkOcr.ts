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

  // 좌표·선 굵기 스케일
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
  const { text } = await runCloudVisionOcrFull(imageBase64, apiKey, 1);
  return text;
}

export interface VisionWordBox {
  text: string;
  xFrac: number; // 0~1 (이미지 너비 비율)
  yFrac: number; // 0~1 (이미지 높이 비율)
  wFrac: number;
  hFrac: number;
}

/**
 * Cloud Vision DOCUMENT_TEXT_DETECTION — 텍스트 + 단어별 바운딩 박스 반환.
 * scale: extractHandwritingImage의 업스케일 배수 (기본 2)
 * 좌표는 캔버스 CSS 픽셀 비율 (0~1) — 어떤 화면 크기에서도 올바르게 표시됨.
 */
export async function runCloudVisionOcrFull(
  imageBase64: string,
  apiKey: string,
  scale = 2,
  canvasW = 1200,
  canvasH = 1600,
): Promise<{ text: string; wordBoxes: VisionWordBox[] }> {
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
  const text = (data.responses?.[0]?.fullTextAnnotation?.text ?? '').trim();

  // textAnnotations[0] = 전체, [1..] = 단어별
  const annotations: any[] = data.responses?.[0]?.textAnnotations ?? [];
  // 이미지 실제 픽셀 크기 = canvasW*scale x canvasH*scale (extractHandwritingImage 기준)
  // 이 값으로 나눠 0~1 정규화 → 화면 크기에 무관하게 정확한 위치 복원 가능
  const physW = canvasW * scale;
  const physH = canvasH * scale;

  const wordBoxes: VisionWordBox[] = annotations.slice(1).map((a: any) => {
    const verts: {x:number;y:number}[] = a.boundingPoly?.vertices ?? [];
    const xs = verts.map((v:any) => v.x ?? 0);
    const ys = verts.map((v:any) => v.y ?? 0);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const x1 = Math.max(...xs), y1 = Math.max(...ys);
    return {
      text: a.description ?? '',
      xFrac: x0 / physW, yFrac: y0 / physH,
      wFrac: (x1 - x0) / physW, hFrac: (y1 - y0) / physH,
    };
  }).filter((b: VisionWordBox) => b.text.trim());

  return { text, wordBoxes };
}
