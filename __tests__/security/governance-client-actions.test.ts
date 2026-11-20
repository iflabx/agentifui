import { callInternalDataAction } from '../../lib/db/internal-data-api';
import {
  getManagementAudit,
  getTaskOperations,
} from '../../lib/services/client/governance-api';
import { createMutationActions } from '../../lib/stores/user-management-store/mutation-actions';

jest.mock('../../lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));

test('session revoke reports cleanup pending without changing account status or exposing tokens', async () => {
  const response = {
    operationId: 'synthetic-op',
    revokedCount: 2,
    cacheCleanup: 'pending' as const,
  };
  jest
    .mocked(callInternalDataAction)
    .mockResolvedValue({ success: true, data: response });
  const actions = createMutationActions(jest.fn(), jest.fn());
  await expect(actions.revokeAllSessions('synthetic-user')).resolves.toEqual(
    response
  );
  expect(callInternalDataAction).toHaveBeenCalledTimes(1);
  expect(callInternalDataAction).toHaveBeenCalledWith(
    'users.revokeAllSessions',
    { userId: 'synthetic-user', reasonCode: 'ADMIN_REQUEST' }
  );
});

test('restricted read clients call only their read actions with bounded filters', async () => {
  await getManagementAudit({ limit: 25, operationId: 'synthetic-operation' });
  await getTaskOperations({ page: 1, limit: 25, state: 'unknown' });
  expect(callInternalDataAction).toHaveBeenCalledWith('audit.getRecent', {
    limit: 25,
    operationId: 'synthetic-operation',
  });
  expect(callInternalDataAction).toHaveBeenCalledWith('tasks.getRecent', {
    page: 1,
    limit: 25,
    state: 'unknown',
  });
});
