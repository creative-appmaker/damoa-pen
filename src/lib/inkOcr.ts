/**
 * ML Kit Digital Ink Recognition — 오프라인 한글 손글씨 인식
 *
 * 이 모듈은 CI 워크플로우에서 자동 생성되는 커스텀 Capacitor 플러그인
 * (InkRecognitionPlugin.java)을 호출합니다.
 *
 * 스트로크 포인트는 { x, y, t } 형식이며 t는 Unix 타임스탬프(ms)입니다.
 */

export interface InkPoint  { x: number; y: number; t: number; }
export interface InkStroke { points: InkPoint[]; }

/**
 * 손글씨 스트로크 데이터로 한글 OCR 수행 (오프라인)
 * @param strokes   PenCanvas의 Stroke 배열
 * @param languageCode  ML Kit 언어 코드 (기본: 'ko-KR')
 */
export async function runInkOcr(
  strokes: Array<{ points: Array<{ x: number; y: number; pressure: number; t?: number }> }>,
  languageCode = 'ko-KR',
): Promise<string> {
  // @capacitor/core는 CI에서만 설치되므로 dynamic import 사용
  const { Capacitor } = await import(/* @vite-ignore */ '@capacitor/core');
  const plugin = (Capacitor as any).Plugins?.['InkRecognition'];
  if (!plugin) throw new Error('InkRecognition 플러그인이 없습니다. 앱 빌드를 확인하세요.');

  // ML Kit Digital Ink 형식으로 변환
  // t 값이 없으면 스트로크별로 1초 간격, 포인트별로 16ms 간격으로 추정
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

  const result = await plugin['recognize']({ strokes: inkStrokes, languageCode });
  return (result?.text ?? '').trim();
}

/**
 * 한국어 디지털 잉크 모델 미리 다운로드 (앱 최초 실행 시 사용)
 * 이후에는 오프라인으로 동작
 */
export async function downloadInkModel(languageCode = 'ko-KR'): Promise<void> {
  const { Capacitor } = await import(/* @vite-ignore */ '@capacitor/core');
  const plugin = (Capacitor as any).Plugins?.['InkRecognition'];
  if (!plugin) throw new Error('InkRecognition 플러그인이 없습니다.');
  await plugin['downloadModel']({ languageCode });
}
