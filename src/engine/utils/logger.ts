/**
 * 日志工具模块
 *
 * 仅在 NODE_ENV=local 时输出日志，生产环境静默
 */

/**
 * 检查是否启用日志（仅在本地开发环境）
 */
function isLoggingEnabled(): boolean {
  return process.env.NODE_ENV === 'local';
}

/**
 * 日志输出（仅在 NODE_ENV=local 时输出）
 */
export const logger = {
  log: (...args: any[]) => {
    if (isLoggingEnabled()) {
      console.log(...args);
    }
  },
  info: (...args: any[]) => {
    if (isLoggingEnabled()) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    if (isLoggingEnabled()) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (isLoggingEnabled()) {
      console.error(...args);
    }
  },
  debug: (...args: any[]) => {
    if (isLoggingEnabled()) {
      console.debug(...args);
    }
  },
};
