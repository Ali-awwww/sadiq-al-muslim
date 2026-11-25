import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sadiqalmuslim.app',
  appName: 'صديق المسلم',
  webDir: 'dist',
  backgroundColor: '#0f766e',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f766e',
      showSpinner: false,
    },
  },
};

export default config;
