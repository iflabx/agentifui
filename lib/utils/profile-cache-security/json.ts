export function safeJsonParse<T = unknown>(json: string): T | null {
  if (!json || typeof json !== 'string') {
    return null;
  }

  try {
    const dangerousPatterns = [
      /__proto__/,
      /constructor.*prototype/,
      /prototype.*constructor/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(json)) {
        console.warn(
          `[Security] Blocked potential prototype pollution attempt`
        );
        return null;
      }
    }

    const parsed = JSON.parse(json);

    if (parsed && typeof parsed === 'object') {
      const dangerousProps = ['__proto__', 'constructor', 'prototype'];
      for (const prop of dangerousProps) {
        if (Object.prototype.hasOwnProperty.call(parsed, prop)) {
          console.warn(
            `[Security] Blocked object with dangerous property: ${prop}`
          );
          return null;
        }
      }

      for (const key in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          const value = parsed[key];
          if (value && typeof value === 'object') {
            for (const prop of dangerousProps) {
              if (Object.prototype.hasOwnProperty.call(value, prop)) {
                console.warn(
                  `[Security] Blocked nested dangerous property: ${key}.${prop}`
                );
                return null;
              }
            }
          }
        }
      }
    }

    return parsed as T;
  } catch (error) {
    console.warn(
      `[Security] JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}
