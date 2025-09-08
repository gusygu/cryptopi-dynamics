// src/core/logger.ts
export const log = {
  info:  (...a: any[]) => console.log('[info]',  ...a),
  warn:  (...a: any[]) => console.warn('[warn]', ...a),
  error: (...a: any[]) => console.error('[err]', ...a),
};
