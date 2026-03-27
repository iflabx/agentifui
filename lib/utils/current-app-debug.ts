type PersistedCurrentAppStoragePayload = {
  state?: {
    currentAppId?: string | null;
    currentAppInstance?: {
      instance_id?: string | null;
      display_name?: string | null;
    } | null;
  };
};

export interface CurrentAppDebugSnapshotInput {
  source: string;
  routeInstanceId?: string | null;
  currentAppId?: string | null;
  currentAppInstanceId?: string | null;
  currentAppDisplayName?: string | null;
  note?: string;
  extra?: Record<string, unknown>;
}

function safeReadWindowPathname(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.location.pathname || null;
}

function safeReadWindowOrigin(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.location.origin || null;
}

function extractRouteInstanceId(pathname: string | null): string | null {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(
    /^\/apps\/(?:agent|chatbot|chatflow|workflow|text-generation)\/([^/]+)$/
  );
  return match?.[1] || null;
}

function readPersistedCurrentAppStorage() {
  if (typeof window === 'undefined') {
    return {
      storageAvailable: false,
      storedCurrentAppId: null,
      storedCurrentAppInstanceId: null,
      storedCurrentAppDisplayName: null,
      parseError: null,
    };
  }

  const raw = window.localStorage.getItem('current-app-storage');
  if (!raw) {
    return {
      storageAvailable: true,
      storedCurrentAppId: null,
      storedCurrentAppInstanceId: null,
      storedCurrentAppDisplayName: null,
      parseError: null,
    };
  }

  try {
    const payload = JSON.parse(raw) as PersistedCurrentAppStoragePayload;
    return {
      storageAvailable: true,
      storedCurrentAppId: payload.state?.currentAppId ?? null,
      storedCurrentAppInstanceId:
        payload.state?.currentAppInstance?.instance_id ?? null,
      storedCurrentAppDisplayName:
        payload.state?.currentAppInstance?.display_name ?? null,
      parseError: null,
    };
  } catch (error) {
    return {
      storageAvailable: true,
      storedCurrentAppId: null,
      storedCurrentAppInstanceId: null,
      storedCurrentAppDisplayName: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function logCurrentAppDebugSnapshot(
  label: string,
  input: CurrentAppDebugSnapshotInput
): void {
  const pathname = safeReadWindowPathname();
  const persisted = readPersistedCurrentAppStorage();

  console.log(label, {
    source: input.source,
    origin: safeReadWindowOrigin(),
    pathname,
    routeInstanceId: input.routeInstanceId ?? extractRouteInstanceId(pathname),
    currentAppId: input.currentAppId ?? null,
    currentAppInstanceId: input.currentAppInstanceId ?? null,
    currentAppDisplayName: input.currentAppDisplayName ?? null,
    storedCurrentAppId: persisted.storedCurrentAppId,
    storedCurrentAppInstanceId: persisted.storedCurrentAppInstanceId,
    storedCurrentAppDisplayName: persisted.storedCurrentAppDisplayName,
    storageAvailable: persisted.storageAvailable,
    storageParseError: persisted.parseError,
    note: input.note ?? null,
    ...(input.extra ? { extra: input.extra } : {}),
  });
}
