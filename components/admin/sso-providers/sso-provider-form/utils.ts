import type {
  CreateSsoProviderData,
  SsoProtocol,
  SsoProvider,
  SsoProviderSettings,
} from '@lib/types/database';

import { getDefaultSettings } from './constants';
import type { SsoSettingsParserResult } from './types';

export function createDefaultSsoProviderFormData(
  protocol: SsoProtocol = 'CAS'
): CreateSsoProviderData {
  return {
    name: '',
    protocol,
    settings: getDefaultSettings(protocol),
    enabled: true,
    display_order: 0,
  };
}

export function createSsoProviderFormDataFromProvider(
  provider: SsoProvider
): CreateSsoProviderData {
  return {
    name: provider.name,
    protocol: provider.protocol,
    settings: provider.settings,
    client_id: provider.client_id,
    client_secret: provider.client_secret,
    metadata_url: provider.metadata_url,
    enabled: provider.enabled,
    display_order: provider.display_order,
    button_text: provider.button_text,
  };
}

export function updateSsoProviderSettings(
  settings: SsoProviderSettings,
  path: string,
  value: unknown
): SsoProviderSettings {
  const nextSettings = { ...settings } as Record<string, unknown>;
  const keys = path.split('.');
  let current: Record<string, unknown> = nextSettings;

  for (let index = 0; index < keys.length - 1; index++) {
    const next = current[keys[index]];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[keys[index]] = {};
    } else {
      current[keys[index]] = { ...(next as Record<string, unknown>) };
    }
    current = current[keys[index]] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return nextSettings as SsoProviderSettings;
}

export function stringifySsoProviderSettings(
  settings: SsoProviderSettings
): string {
  return JSON.stringify(settings, null, 2);
}

export function parseSsoProviderSettingsJson(
  value: string
): SsoSettingsParserResult {
  try {
    return {
      settings: JSON.parse(value) as SsoProviderSettings,
      error: null,
    };
  } catch (error) {
    return {
      settings: null,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}
