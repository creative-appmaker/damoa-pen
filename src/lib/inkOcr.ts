/**
 * ML Kit Digital Ink Recognition — 오프라인 한글 손글씨 인식
 * window.Capacitor.Plugins 를 통해 네이티브 플러그인에 직접 접근합니다.
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

/**
 * 손글씨 스트로크 데이터로 한글 OCR 수행 (오프라인)
 */
export async function runInkOcr(
  strokes: Array<{ points: Array<{ x: number; y: number; pressure: number; t?: number }> }>,
  languageCode = 'ko-KR',
): Promise<string> {
  const plugin = getInkPlugin();

  const inkStrokes: InkStroke[] = strokes
    .filter(s => s.points.length >= 1)
    .map((s, si) => ({
      points: s.points.map((p, pi) => ({
        x: p.x,
        y: p.y,
        t: p.t ?? (si * 1200 + pi * 16),
      })),
    }));

  if (inkStrokes.length === 0) return '';

  const result = await plugin.recognize({ strokes: inkStrokes, languageCode });
  return (result?.text ?? '').trim();
}

/**
 * 한국어 디지털 잉크 모델 미리 다운로드
 */
export async function downloadInkModel(languageCode = 'ko-KR'): Promise<void> {
  const plugin = getInkPlugin();
  await plugin.downloadModel({ languageCode });
}
