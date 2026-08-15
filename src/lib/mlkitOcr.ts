/**
 * ML Kit Text Recognition — 이미지 기반 OCR (한글 포함)
 * window.Capacitor.Plugins 를 통해 네이티브 플러그인에 직접 접근합니다.
 */

export function isNativeAndroid(): boolean {
  try {
    return (window as any)?.Capacitor?.getPlatform?.() === 'android';
  } catch {
    return false;
  }
}

export async function runMlKitOcr(dataUrl: string): Promise<string> {
  const cap = (window as any).Capacitor;
  if (!cap) throw new Error('Capacitor를 찾을 수 없습니다.');

  const Filesystem = cap.Plugins?.Filesystem;
  const TextRecognition = cap.Plugins?.TextRecognition;

  if (!Filesystem) throw new Error('Filesystem 플러그인이 없습니다.');
  if (!TextRecognition) throw new Error('TextRecognition 플러그인이 없습니다.');

  const base64Data = dataUrl.split(',')[1];
  const fileName = `damoa_ocr_${Date.now()}.jpg`;

  // Directory.Cache = 'CACHE'
  await Filesystem.writeFile({ path: fileName, data: base64Data, directory: 'CACHE' });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: 'CACHE' });

  let recognizedText = '';
  try {
    const result = await TextRecognition.recognize({ path: uri });
    recognizedText = result.blocks
      .map((block: { text: string }) => block.text)
      .join('\n')
      .trim();
  } finally {
    try {
      await Filesystem.deleteFile({ path: fileName, directory: 'CACHE' });
    } catch {}
  }
  return recognizedText;
}
