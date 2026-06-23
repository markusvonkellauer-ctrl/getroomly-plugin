module.exports = {
  AppConfig: {
    ai: { defaultApiKey: undefined },
    api: { baseUrl: 'https://api.getroomly.ai' },
    images: {
      maxFileSize: 10 * 1024 * 1024,
      allowedFormats: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    },
    features: {
      enableAnalytics: false,
      debugCoordinates: false,
    },
    services: {
      analytics: { googleAnalyticsId: undefined, enabled: false },
    },
  },
};
