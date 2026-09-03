import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.damoa.pen',
  appName: '다모아 펜',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: {
    // 내비게이션 바 뒤까지 레이아웃 확장 — Sticky Immersive Mode와 함께 사용해야 nav bar 숨김 유지
    backgroundColor: '#000000',
  },
};

export default config;
