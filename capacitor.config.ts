const config = {
  appId: 'com.ecoverify.portal',
  appName: 'EcoVerify',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
