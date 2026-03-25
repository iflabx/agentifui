/** @jest-environment node */
import {
  escapeLike,
  mapGroupMemberRow,
  mapGroupPermissionRow,
} from '@lib/db/group-permissions/helpers';

describe('group permission helpers', () => {
  it('maps group member rows with optional profile data', () => {
    expect(
      mapGroupMemberRow({
        id: 'm1',
        group_id: 'g1',
        user_id: 'u1',
        created_at: '2026-03-25T00:00:00Z',
        profile_id: 'u1',
        profile_username: 'alice',
        profile_full_name: 'Alice',
        profile_email: 'alice@example.com',
      })
    ).toEqual({
      id: 'm1',
      group_id: 'g1',
      user_id: 'u1',
      created_at: '2026-03-25T00:00:00Z',
      user: {
        id: 'u1',
        username: 'alice',
        full_name: 'Alice',
        email: 'alice@example.com',
      },
    });
  });

  it('maps group permission rows and normalizes numeric fields', () => {
    expect(
      mapGroupPermissionRow({
        id: 'p1',
        group_id: 'g1',
        service_instance_id: 's1',
        is_enabled: 1,
        usage_quota: '25',
        used_count: '4',
        created_at: '2026-03-25T00:00:00Z',
        app_id: 'a1',
        app_display_name: 'Demo',
        app_instance_id: 'demo',
        app_visibility: 'group_only',
      })
    ).toEqual({
      id: 'p1',
      group_id: 'g1',
      service_instance_id: 's1',
      is_enabled: true,
      usage_quota: 25,
      used_count: 4,
      created_at: '2026-03-25T00:00:00Z',
      app: {
        id: 'a1',
        display_name: 'Demo',
        instance_id: 'demo',
        visibility: 'group_only',
      },
    });
  });

  it('escapes like wildcards for user search', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});
