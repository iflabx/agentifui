/** @jest-environment node */
import {
  createDefaultSsoProviderFormData,
  createSsoProviderFormDataFromProvider,
  parseSsoProviderSettingsJson,
  stringifySsoProviderSettings,
  updateSsoProviderSettings,
} from '@components/admin/sso-providers/sso-provider-form/utils';

describe('sso provider form utils', () => {
  it('creates protocol-specific defaults for new providers', () => {
    const oidcData = createDefaultSsoProviderFormData('OIDC');
    expect(oidcData.protocol).toBe('OIDC');
    expect(oidcData.settings.protocol_config.scope).toBe(
      'openid profile email'
    );
    expect(oidcData.settings.protocol_config.response_type).toBe('code');
  });

  it('maps an existing provider into editable form data', () => {
    const provider = {
      id: 'provider-1',
      name: 'Campus CAS',
      protocol: 'CAS',
      settings: createDefaultSsoProviderFormData('CAS').settings,
      client_id: null,
      client_secret: null,
      metadata_url: null,
      enabled: true,
      display_order: 2,
      button_text: 'Login',
      created_at: '2026-03-25T00:00:00.000Z',
      updated_at: '2026-03-25T00:00:00.000Z',
    } as const;

    const formData = createSsoProviderFormDataFromProvider(provider);
    expect(formData.name).toBe('Campus CAS');
    expect(formData.display_order).toBe(2);
    expect(formData.button_text).toBe('Login');
  });

  it('updates nested settings without losing sibling fields', () => {
    const settings = createDefaultSsoProviderFormData('CAS').settings;
    const updated = updateSsoProviderSettings(
      settings,
      'protocol_config.endpoints.login',
      '/cas/login'
    );

    expect(updated.protocol_config.endpoints.login).toBe('/cas/login');
    expect(updated.protocol_config.endpoints.logout).toBe('/logout');
    expect(settings.protocol_config.endpoints.login).toBe('/login');
  });

  it('parses and stringifies settings json safely', () => {
    const settings = createDefaultSsoProviderFormData('CAS').settings;
    const serialized = stringifySsoProviderSettings(settings);
    const parsed = parseSsoProviderSettingsJson(serialized);
    expect(parsed.error).toBeNull();
    expect(parsed.settings).toMatchObject(settings);

    const invalid = parseSsoProviderSettingsJson('{bad json');
    expect(invalid.settings).toBeNull();
    expect(invalid.error).toBeTruthy();
  });
});
