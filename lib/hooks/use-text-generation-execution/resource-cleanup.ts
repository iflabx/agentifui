type AbortControllerRef = {
  current: AbortController | null;
};

export function cleanupTextGenerationResources(
  abortControllerRef: AbortControllerRef,
  abortRequest: boolean = false
): void {
  if (abortControllerRef.current) {
    if (abortRequest) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = null;
  }
}
