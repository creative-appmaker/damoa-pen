export function isNativeAndroid(): boolean {
  try {
    // @ts-ignore
    return window?.Capacitor?.getPlatform?.() === 'android';
  } catch {
    return false;
  }
}

export async function runMlKitOcr(dataUrl: string): Promise<string> {
  // Dynamic imports with @vite-ignore so Vite's dev server doesn't try to resolve them
  const { Filesystem, Directory } = await import(/* @vite-ignore */ '@capacitor/filesystem');
  const { TextRecognition } = await import(/* @vite-ignore */ '@capacitor-mlkit/text-recognition');

  const base64Data = dataUrl.split(',')[1];
  const fileName = `damoa_ocr_${Date.now()}.jpg`;

  await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

  let recognizedText = '';
  try {
    const result = await TextRecognition.recognize({ path: uri });
    recognizedText = result.blocks
      .map((block: { text: string }) => block.text)
      .join('\n')
      .trim();
  } finally {
    try { await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }); } catch {}
  }
  return recognizedText;
}
