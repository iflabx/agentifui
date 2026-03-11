import {
  buildManagedCasLoginUrl,
  buildManagedCasValidateUrl,
  parseCasServiceResponse,
  resolveManagedCasProfile,
  toManagedCasProviderConfig,
  toPublicManagedSsoProvider,
} from '@lib/auth/managed-sso';
import { SsoProvider } from '@lib/types/database';

function createCasProvider(overrides?: Partial<SsoProvider>): SsoProvider {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'BISTU CAS',
    protocol: 'CAS',
    settings: {
      email_domain: 'bistu.edu.cn',
      protocol_config: {
        base_url: 'https://sso.bistu.edu.cn',
        endpoints: {
          login: '/login',
          logout: '/logout',
          validate: '/serviceValidate',
          validate_v3: '/p3/serviceValidate',
        },
        attributes_mapping: {
          employee_id: 'cas:user',
          username: 'log_username',
          full_name: 'cas:name',
          email: 'mail',
        },
      },
      security: {
        require_https: true,
        validate_certificates: true,
        allowed_redirect_hosts: ['bistu.edu.cn'],
      },
      ui: {
        icon: '🏛️',
        description: '北京信息科技大学统一认证系统',
      },
    },
    client_id: null,
    client_secret: null,
    metadata_url: null,
    enabled: true,
    display_order: 0,
    button_text: '北信科统一认证',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('managed sso helpers', () => {
  it('maps CAS provider into public login provider', () => {
    const provider = toPublicManagedSsoProvider(createCasProvider());

    expect(provider).toEqual(
      expect.objectContaining({
        providerId: '11111111-1111-4111-8111-111111111111',
        authFlow: 'managed-cas',
        mode: 'managed-cas',
        icon: '🏛️',
        displayName: '北信科统一认证',
        domain: 'bistu.edu.cn',
      })
    );
  });

  it('parses CAS service response and resolves profile', () => {
    const xml = `
      <cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
        <cas:authenticationSuccess>
          <cas:user>20260001</cas:user>
          <cas:attributes>
            <cas:log_username>zhangsan</cas:log_username>
            <cas:name>张三</cas:name>
            <cas:employeeNumber>20260001</cas:employeeNumber>
          </cas:attributes>
        </cas:authenticationSuccess>
      </cas:serviceResponse>
    `;

    const parsed = parseCasServiceResponse(xml);
    const config = toManagedCasProviderConfig(createCasProvider());
    expect(config).not.toBeNull();

    const profile = resolveManagedCasProfile(config!, parsed);
    expect(parsed.success).toBe(true);
    expect(parsed.user).toBe('20260001');
    expect(profile).toEqual(
      expect.objectContaining({
        subject: '20260001',
        username: 'zhangsan',
        fullName: '张三',
        email: '20260001@bistu.edu.cn',
        employeeNumber: '20260001',
      })
    );
  });

  it('builds CAS login and validate URLs with stable service', () => {
    const config = toManagedCasProviderConfig(createCasProvider());
    expect(config).not.toBeNull();

    const serviceUrl =
      'https://agent.bistu.edu.cn/api/sso/11111111-1111-4111-8111-111111111111/callback?returnUrl=%2Fchat';

    expect(buildManagedCasLoginUrl(config!, serviceUrl)).toBe(
      'https://sso.bistu.edu.cn/login?service=https%3A%2F%2Fagent.bistu.edu.cn%2Fapi%2Fsso%2F11111111-1111-4111-8111-111111111111%2Fcallback%3FreturnUrl%3D%252Fchat'
    );
    expect(buildManagedCasValidateUrl(config!, serviceUrl, 'ST-123')).toBe(
      'https://sso.bistu.edu.cn/p3/serviceValidate?service=https%3A%2F%2Fagent.bistu.edu.cn%2Fapi%2Fsso%2F11111111-1111-4111-8111-111111111111%2Fcallback%3FreturnUrl%3D%252Fchat&ticket=ST-123'
    );
  });
});
