type EventSourceRef = {
  current: EventSource | null;
};

type AbortControllerRef = {
  current: AbortController | null;
};

export function cleanupWorkflowExecutionResources(
  sseConnectionRef: EventSourceRef,
  abortControllerRef: AbortControllerRef,
  abortRequest: boolean = false
): void {
  if (sseConnectionRef.current) {
    sseConnectionRef.current.close();
    sseConnectionRef.current = null;
  }

  if (abortControllerRef.current) {
    if (abortRequest) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = null;
  }
}
