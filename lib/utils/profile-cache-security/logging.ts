export function secureLog(
  level: 'log' | 'warn' | 'error',
  category: string,
  message: string,
  sensitiveData?: string
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  let logMessage = `[${category}] ${message}`;

  if (sensitiveData) {
    if (isProduction) {
      logMessage += ' [sensitive data masked]';
    } else {
      const masked =
        sensitiveData.length > 8
          ? sensitiveData.substring(0, 4) +
            '***' +
            sensitiveData.substring(sensitiveData.length - 4)
          : '***';
      logMessage += ` (${masked})`;
    }
  }

  console[level](logMessage);
}
