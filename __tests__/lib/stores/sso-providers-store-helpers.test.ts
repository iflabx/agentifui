/** @jest-environment node */
import {
  buildPaginationState,
  getErrorMessage,
  toggleSelectedProviderIds,
  updateLoadingState,
} from '@lib/stores/sso-providers-store/helpers';

describe('sso providers store helpers', () => {
  it('formats errors and pagination state', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(getErrorMessage('x', 'fallback')).toBe('fallback');
    expect(
      buildPaginationState({
        providers: [],
        total: 12,
        page: 2,
        pageSize: 5,
        totalPages: 3,
      })
    ).toEqual({ total: 12, page: 2, pageSize: 5, totalPages: 3 });
  });

  it('updates loading flags and toggles selected ids', () => {
    expect(
      updateLoadingState(
        {
          providers: false,
          stats: false,
          providerDetail: false,
          updating: false,
          deleting: false,
          creating: false,
          toggling: false,
          reordering: false,
        },
        'creating',
        true
      )
    ).toMatchObject({ creating: true });
    expect(toggleSelectedProviderIds([], 'p1')).toEqual(['p1']);
    expect(toggleSelectedProviderIds(['p1'], 'p1')).toEqual([]);
  });
});
