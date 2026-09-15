/**
 * pdfNative.ts
 * Android 네이티브 PdfRenderer Capacitor 플러그인 래퍼.
 * Capacitor 환경(Android)에서만 동작하며, 웹/iOS에서는 isNativePdfAvailable() === false.
 */

const getPlugin = (): any =>
  typeof window !== 'undefined' ? (window as any).Capacitor?.Plugins?.PdfRenderer : null;

/** 네이티브 PDF 렌더러 사용 가능 여부 */
export const isNativePdfAvailable = (): boolean => !!getPlugin();

/**
 * PDF base64 문자열을 Android 측 캐시에 로드.
 * 이후 renderNativePdfPage()로 페이지별 렌더링.
 * @returns 총 페이지 수
 */
export async function openNativePdf(pdfBase64: string): Promise<number> {
  const result = await getPlugin().openPdf({ pdfBase64 });
  return result.pageCount as number;
}

/**
 * 특정 페이지를 네이티브 렌더러로 렌더링 → ImageBitmap 반환.
 * @param pageIndex 0-based 페이지 인덱스
 * @param targetWidth 물리 픽셀 기준 렌더 너비 (DPR 포함, e.g. cssW * dpr)
 */
export async function renderNativePdfPage(
  pageIndex: number,
  targetWidth: number,
): Promise<ImageBitmap | null> {
  try {
    const result = await getPlugin().renderPage({ pageIndex, targetWidth });
    const b64: string = result.imageBase64;
    // base64 → Uint8Array → Blob → ImageBitmap (GPU-backed)
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    return await createImageBitmap(blob);
  } catch (e) {
    console.warn('[pdfNative] renderPage 실패:', e);
    return null;
  }
}

/** Android 측 PDF 리소스 해제 (임시 파일 삭제) */
export async function closeNativePdf(): Promise<void> {
  try { await getPlugin()?.closePdf({}); } catch (_) { /* ignore */ }
}
