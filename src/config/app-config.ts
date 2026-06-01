/**
 * Centralized Application Configuration
 *
 * All environment variables are managed here.
 * Never import import.meta.env or process.env directly in components.
 * Always import from this config file.
 */

// Helper function to get env var or return undefined/default
const getEnvVar = (key: string, defaultValue?: string): string | undefined => {
  // Safely access import.meta.env or return default
  try {
    const value = import.meta?.env?.[key];
    if (!value || value === '') {
      return defaultValue;
    }
    return value;
  } catch (e) {
    // If import.meta.env is not available (server context), return default
    return defaultValue;
  }
};

const getBooleanEnv = (key: string, defaultValue: boolean = false): boolean => {
  const value = getEnvVar(key);
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
};

const getNumberEnv = (key: string, defaultValue?: number): number | undefined => {
  const value = getEnvVar(key);
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

// ==============================================
// Application Configuration
// ==============================================

export const AppConfig = {
  // Environment
  env: getEnvVar('VITE_APP_ENV', 'development') as 'development' | 'staging' | 'production',
  isDevelopment: getEnvVar('VITE_APP_ENV', 'development') === 'development',
  isProduction: getEnvVar('VITE_APP_ENV', 'development') === 'production',

  // AI Service Configuration
  ai: {
    // Demo partner API key for plugin development (origin-locked to localhost + plugin.getroomly.ai)
    // Production partners get their own key via backend CLI - they override via window.GetRoomlyEmbedConfig.apiKey
    defaultApiKey: getEnvVar('VITE_GETROOMLY_API_KEY', 'grm_pub_fd6c7150cc297be6fc73db3e1edd3b3ff49afc4a80819743'),
    fallbackImageUrl: getEnvVar('VITE_FALLBACK_IMAGE_URL', 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?q=80&w=800'),
    // Image compression settings before sending to backend
    maxImageDimension: getNumberEnv('VITE_MAX_IMAGE_DIMENSION', 1600),
  },

  // API Configuration - GetRoomly Backend (handles AI generation, partner auth)
  api: {
    // TODO: switch to https://api.getroomly.ai once nginx + TLS land (backend ticket GET-17)
    baseUrl: getEnvVar('VITE_API_BASE_URL', 'http://178.105.148.65:3000'),
    timeout: getNumberEnv('VITE_API_TIMEOUT', 30000),
    uploadTimeout: getNumberEnv('VITE_UPLOAD_TIMEOUT', 60000),
    retryAttempts: getNumberEnv('VITE_API_RETRY_ATTEMPTS', 3),
  },

  // External Services
  services: {
    // Supabase
    supabase: {
      url: getEnvVar('VITE_SUPABASE_URL'),
      publishableKey: getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY'),
    },

    // Archive Service
    archive: {
      serviceUrl: getEnvVar('VITE_ARCHIVE_SERVICE_URL'),
      apiKey: getEnvVar('VITE_ARCHIVE_API_KEY'),
    },

    // Feedback Service
    feedback: {
      serviceUrl: getEnvVar('VITE_FEEDBACK_SERVICE_URL'),
    },

    // Analytics
    analytics: {
      googleAnalyticsId: getEnvVar('VITE_GA_MEASUREMENT_ID'),
      enabled: getBooleanEnv('VITE_ENABLE_ANALYTICS', true),
    },

    // Error Reporting
    sentry: {
      dsn: getEnvVar('VITE_SENTRY_DSN'),
    },
  },

  // Features Configuration
  features: {
    debugCoordinates: getBooleanEnv('VITE_DEBUG_COORDINATES', false),
    enableAnalytics: getBooleanEnv('VITE_ENABLE_ANALYTICS', true),
  },

  // Image Processing
  images: {
    maxWidth: getNumberEnv('VITE_MAX_IMAGE_WIDTH', 1600),
    maxFileSize: getNumberEnv('VITE_MAX_FILE_SIZE', 10485760), // 10MB
    compressionQuality: getNumberEnv('VITE_COMPRESSION_QUALITY', 75) / 100, // Convert to 0-1
    allowedFormats: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const,
  },

  // UI Configuration
  ui: {
    defaultLanguage: getEnvVar('VITE_DEFAULT_LANGUAGE', 'en') as 'en' | 'sv',
    defaultTheme: getEnvVar('VITE_DEFAULT_THEME', 'light') as 'light' | 'dark',
  },

  // Rate Limiting
  rateLimiting: {
    requestsPerMinute: getNumberEnv('VITE_RATE_LIMIT_RPM', 10),
    windowMs: getNumberEnv('VITE_RATE_LIMIT_WINDOW_MS', 60000), // 1 minute
  },

  // Development Configuration
  dev: {
    hmrPort: getNumberEnv('VITE_HMR_PORT', 24678),
    enableMocking: getBooleanEnv('VITE_ENABLE_MOCKING', false),
  },

  // Demo/Placeholder Configuration
  demo: {
    chairImageUrl: getEnvVar('VITE_DEMO_CHAIR_IMAGE', 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?q=80&w=800'),
    sofaImageUrl: getEnvVar('VITE_DEMO_SOFA_IMAGE', 'https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?q=80&w=800'),
    tableImageUrl: getEnvVar('VITE_DEMO_TABLE_IMAGE', 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?q=80&w=800'),
  },
} as const;

// ==============================================
// Validation & Warnings
// ==============================================

// Validate required configuration in production
if (AppConfig.isProduction) {
  if (!AppConfig.ai.defaultApiKey) {
    console.error('❌ Missing required configuration: GetRoomly Partner API Key');
  }
  if (!AppConfig.api.baseUrl) {
    console.error('❌ Missing required configuration: GetRoomly Backend Base URL');
  }
}

// Development warnings
if (AppConfig.isDevelopment) {
  if (!AppConfig.services.analytics.googleAnalyticsId) {
    console.warn('⚠️ Google Analytics not configured');
  }
}

// ==============================================
// Export Types
// ==============================================

export type AppEnvironment = typeof AppConfig.env;
export type SupportedLanguage = typeof AppConfig.ui.defaultLanguage;
export type SupportedTheme = typeof AppConfig.ui.defaultTheme;

// ==============================================
// Helper Functions
// ==============================================

export const isFeatureEnabled = (feature: keyof typeof AppConfig.features): boolean => {
  return AppConfig.features[feature];
};

export const getApiUrl = (endpoint: string): string => {
  const baseUrl = AppConfig.api.baseUrl;
  if (!baseUrl) return endpoint; // Relative URL for development
  return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};

export const isServiceConfigured = (service: keyof typeof AppConfig.services): boolean => {
  const serviceConfig = AppConfig.services[service];
  if (typeof serviceConfig === 'object' && serviceConfig !== null) {
    return Object.values(serviceConfig).some(value => value !== undefined);
  }
  return false;
};

// Log configuration in development
if (AppConfig.isDevelopment) {
  console.log('🔧 GetRoomly Embed Configuration:', {
    env: AppConfig.env,
    apiBaseUrl: AppConfig.api.baseUrl,
    hasDefaultApiKey: !!AppConfig.ai.defaultApiKey,
    debugFeatures: AppConfig.features.debugCoordinates,
  });
}