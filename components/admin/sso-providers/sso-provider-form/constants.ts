import type { SsoProtocol, SsoProviderSettings } from '@lib/types/database';
import { Globe, Key, Lock, Palette, Settings, Shield } from 'lucide-react';

import type { SsoProviderFormTab, SsoProviderTranslate } from './types';

export const protocolIcons: Record<SsoProtocol, typeof Globe> = {
  CAS: Globe,
  SAML: Key,
  OAuth2: Lock,
  OIDC: Settings,
};

export function getDefaultSettings(protocol: SsoProtocol): SsoProviderSettings {
  const baseSettings: SsoProviderSettings = {
    protocol_config: {
      base_url: '',
      endpoints: {
        login: '/login',
        logout: '/logout',
        validate: '/serviceValidate',
      },
      attributes_mapping: {
        employee_id: 'cas:user',
        username: 'cas:username',
        full_name: 'cas:name',
        email: 'cas:mail',
      },
    },
    security: {
      require_https: true,
      validate_certificates: true,
      allowed_redirect_hosts: [],
    },
    ui: {
      icon: '🏛️',
      theme: 'primary',
    },
  };

  switch (protocol) {
    case 'CAS':
      return {
        ...baseSettings,
        protocol_config: {
          ...baseSettings.protocol_config,
          version: '2.0',
          timeout: 10000,
          endpoints: {
            ...baseSettings.protocol_config.endpoints,
            validate_v3: '/p3/serviceValidate',
          },
        },
      };
    case 'OIDC':
      return {
        ...baseSettings,
        protocol_config: {
          ...baseSettings.protocol_config,
          scope: 'openid profile email',
          response_type: 'code',
          attributes_mapping: {
            employee_id: 'sub',
            username: 'preferred_username',
            full_name: 'name',
            email: 'email',
          },
        },
      };
    case 'SAML':
      return {
        ...baseSettings,
        protocol_config: {
          ...baseSettings.protocol_config,
          attributes_mapping: {
            employee_id: 'urn:oid:0.9.2342.19200300.100.1.1',
            username: 'urn:oid:0.9.2342.19200300.100.1.1',
            full_name: 'urn:oid:2.5.4.3',
            email: 'urn:oid:1.2.840.113549.1.9.1',
          },
        },
      };
    default:
      return baseSettings;
  }
}

export function createSsoProviderTabs(
  t: SsoProviderTranslate
): SsoProviderFormTab[] {
  return [
    {
      id: 'basic',
      label: t('tabs.basicInfo'),
      icon: Shield,
      color: 'blue',
    },
    {
      id: 'protocol',
      label: t('tabs.protocolConfig'),
      icon: Settings,
      color: 'purple',
    },
    {
      id: 'security',
      label: t('tabs.security'),
      icon: Lock,
      color: 'red',
    },
    {
      id: 'ui',
      label: t('tabs.uiSettings'),
      icon: Palette,
      color: 'green',
    },
  ];
}

export function getTabColorClasses(
  color: SsoProviderFormTab['color'],
  isActive: boolean,
  isDark: boolean
): string {
  const colorMap = {
    blue: {
      active: isDark
        ? 'bg-blue-500/20 text-blue-400 border-blue-500'
        : 'bg-blue-50 text-blue-700 border-blue-500',
      inactive: isDark
        ? 'text-stone-400 hover:text-blue-400'
        : 'text-stone-600 hover:text-blue-600',
    },
    purple: {
      active: isDark
        ? 'bg-purple-500/20 text-purple-400 border-purple-500'
        : 'bg-purple-50 text-purple-700 border-purple-500',
      inactive: isDark
        ? 'text-stone-400 hover:text-purple-400'
        : 'text-stone-600 hover:text-purple-600',
    },
    red: {
      active: isDark
        ? 'bg-red-500/20 text-red-400 border-red-500'
        : 'bg-red-50 text-red-700 border-red-500',
      inactive: isDark
        ? 'text-stone-400 hover:text-red-400'
        : 'text-stone-600 hover:text-red-600',
    },
    green: {
      active: isDark
        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500'
        : 'bg-emerald-50 text-emerald-700 border-emerald-500',
      inactive: isDark
        ? 'text-stone-400 hover:text-emerald-400'
        : 'text-stone-600 hover:text-emerald-600',
    },
  };

  return colorMap[color][isActive ? 'active' : 'inactive'];
}
