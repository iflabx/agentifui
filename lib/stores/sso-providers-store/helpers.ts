import type { LoadingState, ProvidersListPayload } from './types';

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function updateLoadingState(
  loading: LoadingState,
  key: keyof LoadingState,
  value: boolean
): LoadingState {
  return {
    ...loading,
    [key]: value,
  };
}

export function buildPaginationState(payload: ProvidersListPayload) {
  return {
    total: payload.total,
    page: payload.page,
    pageSize: payload.pageSize,
    totalPages: payload.totalPages,
  };
}

export function toggleSelectedProviderIds(
  selectedProviderIds: string[],
  providerId: string
) {
  return selectedProviderIds.includes(providerId)
    ? selectedProviderIds.filter(id => id !== providerId)
    : [...selectedProviderIds, providerId];
}
