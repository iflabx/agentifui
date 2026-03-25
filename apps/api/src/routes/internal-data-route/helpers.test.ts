/** @jest-environment node */
import {
  buildAssistantPreview,
  encryptApiKeyValue,
  escapeLikePattern,
  normalizeNullableTextValue,
  parsePositiveInt,
  resolveEditableProfileColumns,
  sanitizeMessage,
  sanitizeProfileRow,
} from './helpers';

describe('internal data route helpers', () => {
  it('parses and normalizes basic values', () => {
    expect(parsePositiveInt('12.7', 1)).toBe(12);
    expect(parsePositiveInt('x', 1)).toBe(1);
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(normalizeNullableTextValue('  demo  ')).toBe('demo');
    expect(normalizeNullableTextValue('   ')).toBeNull();
  });

  it('builds safe previews and encrypted api keys', () => {
    expect(buildAssistantPreview('<think>internal</think>Visible reply')).toBe(
      'Visible reply'
    );
    expect(encryptApiKeyValue('secret', 'master-key').split(':')).toHaveLength(
      3
    );
  });

  it('sanitizes profile and message rows', () => {
    expect(resolveEditableProfileColumns('native').has('full_name')).toBe(true);
    expect(
      sanitizeMessage({
        id: 'm1',
        metadata: null,
        status: null,
        is_synced: undefined,
        sequence_index: undefined,
      } as never)
    ).toMatchObject({
      metadata: {},
      status: 'sent',
      is_synced: true,
      sequence_index: 0,
    });

    expect(
      sanitizeProfileRow({
        id: 'u1',
        email: 'user@example.com',
        phone: null,
        created_at: '2026-03-25T00:00:00Z',
        updated_at: '2026-03-25T00:00:00Z',
        last_login: null,
        full_name: 'User',
        username: 'user',
        avatar_url: null,
        role: 'user',
        status: 'active',
        auth_source: 'native',
        sso_provider_id: null,
        employee_number: null,
      } as never)
    ).toMatchObject({
      auth_source: 'native',
      is_idp_managed: false,
      editable_fields: expect.arrayContaining(['full_name']),
    });
  });
});
