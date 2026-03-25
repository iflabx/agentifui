import type {
  CreateSsoProviderData,
  SsoProtocol,
  SsoProvider,
  SsoProviderSettings,
} from '@lib/types/database';
import type { LucideIcon } from 'lucide-react';

import type { Dispatch, SetStateAction } from 'react';

export interface SsoProviderFormProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  provider?: SsoProvider | null;
  onClose: () => void;
}

export type SsoProviderTabId = 'basic' | 'protocol' | 'security' | 'ui';

export type SsoProviderTranslate = (
  key: string,
  values?: Record<string, string | number | Date>
) => string;

export interface SsoProviderFormTab {
  id: SsoProviderTabId;
  label: string;
  icon: LucideIcon;
  color: 'blue' | 'purple' | 'red' | 'green';
}

export interface SsoProviderFormStateProps {
  isDark: boolean;
  t: SsoProviderTranslate;
  formData: CreateSsoProviderData;
  setFormData: Dispatch<SetStateAction<CreateSsoProviderData>>;
  handleProtocolChange: (protocol: SsoProtocol) => void;
  handleSettingsChange: (path: string, value: unknown) => void;
}

export interface SsoProviderBasicTabProps
  extends Pick<
    SsoProviderFormStateProps,
    | 'isDark'
    | 't'
    | 'formData'
    | 'setFormData'
    | 'handleProtocolChange'
    | 'handleSettingsChange'
  > {
  protocolIcons: Record<SsoProtocol, LucideIcon>;
}

export type SsoProviderProtocolTabProps = Pick<
  SsoProviderFormStateProps,
  'isDark' | 't' | 'formData' | 'handleSettingsChange'
>;

export type SsoProviderSecurityTabProps = Pick<
  SsoProviderFormStateProps,
  'isDark' | 't' | 'formData' | 'handleSettingsChange'
>;

export type SsoProviderUiTabProps = Pick<
  SsoProviderFormStateProps,
  'isDark' | 't' | 'formData' | 'handleSettingsChange'
>;

export interface SsoProviderSidebarProps {
  activeTab: SsoProviderTabId;
  isDark: boolean;
  showRawJson: boolean;
  tabs: SsoProviderFormTab[];
  onSelectTab: (tab: SsoProviderTabId) => void;
  onToggleRawJson: () => void;
  t: SsoProviderTranslate;
}

export interface SsoProviderRawJsonEditorProps {
  isDark: boolean;
  jsonError: string | null;
  onChange: (value: string) => void;
  t: SsoProviderTranslate;
  value: string;
}

export type SsoSettingsParserResult =
  | { settings: SsoProviderSettings; error: null }
  | { settings: null; error: string };

export type SsoProviderFormInitializer = (
  protocol?: SsoProtocol
) => CreateSsoProviderData;
