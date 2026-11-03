/**
 * Environment Detection Utilities
 * Automatically detects if running on local development or EC2
 */

export const isEC2 = () => {
  return !isLocal();
};

export const isLocal = () => {
  // Match runtimeMode.ts isLocalhost(): 127.* loopback, localhost, or 0.0.0.0.
  // All three are dev/loopback hosts; customer environments use real hostnames.
  const host = window.location.hostname
  return /^127\./.test(host) || host === 'localhost' || host === '0.0.0.0'
};

export const getEnvironment = () => {
  if (isEC2()) return 'EC2';
  if (isLocal()) return 'LOCAL';
  return 'UNKNOWN';
};

export const getEnvironmentConfig = () => {
  const env = getEnvironment();
  
  const configs = {
    LOCAL: {
      API_BASE_URL: import.meta.env.VITE_API_BASE_URL || `${window.location.origin}`,
      FRONTEND_URL: window.location.origin,
      BACKEND_PORT: 8010,
      DEBUG: true
    },
    EC2: {
      API_BASE_URL: import.meta.env.VITE_API_BASE_URL || `${window.location.origin}`,
      FRONTEND_URL: window.location.origin,
      BACKEND_PORT: parseInt(import.meta.env.VITE_BACKEND_PORT) || 9010,
      DEBUG: false
    }
  };
  
  return configs[env] || configs.LOCAL;
};

export const logEnvironment = () => {
  const env = getEnvironment();
  const config = getEnvironmentConfig();
  
  console.log(`🌍 Environment detected: ${env}`);
  console.log(`🔧 API Base URL: ${config.API_BASE_URL}`);
  console.log(`🌐 Frontend URL: ${config.FRONTEND_URL}`);
  console.log(`🔌 Backend Port: ${config.BACKEND_PORT}`);
};
