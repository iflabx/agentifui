import { useEffect, useRef, useState } from 'react';

const THINK_PREVIEW_THROTTLE_MS = 700;

export function useThrottledThinkPreview(
  previewText: string | undefined,
  shouldThrottle: boolean
): string | undefined {
  const [displayPreviewText, setDisplayPreviewText] = useState(previewText);
  const lastFlushAtRef = useRef(previewText && shouldThrottle ? Date.now() : 0);
  const pendingPreviewRef = useRef(previewText);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pendingPreviewRef.current = previewText;
  }, [previewText]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!shouldThrottle || !previewText) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setDisplayPreviewText(previewText);
      lastFlushAtRef.current = previewText ? Date.now() : 0;
      return;
    }

    if (previewText === displayPreviewText) {
      return;
    }

    const now = Date.now();
    const elapsedMs = now - lastFlushAtRef.current;

    if (!displayPreviewText || lastFlushAtRef.current === 0) {
      setDisplayPreviewText(previewText);
      lastFlushAtRef.current = now;
      return;
    }

    if (elapsedMs >= THINK_PREVIEW_THROTTLE_MS) {
      setDisplayPreviewText(previewText);
      lastFlushAtRef.current = now;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDisplayPreviewText(pendingPreviewRef.current);
      lastFlushAtRef.current = Date.now();
      timeoutRef.current = null;
    }, THINK_PREVIEW_THROTTLE_MS - elapsedMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [displayPreviewText, previewText, shouldThrottle]);

  return displayPreviewText;
}
