/** @jest-environment node */
import { publishProfileChangeBestEffort } from '@lib/db/users/shared';
import { publishTableChangeEvent } from '@lib/server/realtime/publisher';

jest.mock('@lib/server/realtime/publisher', () => ({
  publishTableChangeEvent: jest.fn(),
}));

describe('user profile realtime publication', () => {
  const input = {
    eventType: 'UPDATE' as const,
    oldRow: { id: 'synthetic-user', role: 'user' },
    newRow: { id: 'synthetic-user', role: 'admin' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the bundled server publisher and forwards the profile change', async () => {
    jest.mocked(publishTableChangeEvent).mockResolvedValue(undefined);
    await publishProfileChangeBestEffort(input);
    expect(publishTableChangeEvent).toHaveBeenCalledWith({
      table: 'profiles',
      ...input,
    });
  });

  it('keeps publication failure best-effort after the database write', async () => {
    jest
      .mocked(publishTableChangeEvent)
      .mockRejectedValue(new Error('synthetic failure'));
    const warning = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await expect(
      publishProfileChangeBestEffort(input)
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
