// ML Kit 제거됨 — Cloud Vision으로 대체
// 이 파일은 하위 호환성을 위해 유지됩니다.
export function isNativeAndroid(): boolean {
  try { return (window as any)?.Capacitor?.getPlatform?.() === 'android'; } catch { return false; }
}
