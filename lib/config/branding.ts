import type { SupportedLocale } from './language-config';

export type BrandValueByLocale = {
  default: string;
  locales?: Partial<Record<SupportedLocale, string>>;
};

export type BrandProfile = {
  projectName: BrandValueByLocale;
  productName: BrandValueByLocale;
  publicDomain: BrandValueByLocale;
  protectedTerms: string[];
};

export const RESERVED_BRAND_VARIABLE_NAMES = [
  'productName',
  'projectName',
  'publicDomain',
  'year',
] as const;

export type ReservedBrandVariableName =
  (typeof RESERVED_BRAND_VARIABLE_NAMES)[number];

const BRAND_PROFILE: BrandProfile = {
  projectName: {
    default: 'AgentifUI',
  },
  productName: {
    default: 'BistuCopilot',
  },
  publicDomain: {
    default: 'chat.bistu.edu.cn',
  },
  protectedTerms: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveLocalizedValue(
  value: BrandValueByLocale,
  locale: string
): string {
  if (value.locales && locale in value.locales) {
    const localized = value.locales[locale as SupportedLocale];
    if (localized) {
      return localized;
    }
  }

  return value.default;
}

function collectBrandValues(value: BrandValueByLocale): string[] {
  const values = [value.default];

  if (value.locales) {
    values.push(...Object.values(value.locales));
  }

  return values.filter(Boolean);
}

export function getReservedVariableNames(): readonly ReservedBrandVariableName[] {
  return RESERVED_BRAND_VARIABLE_NAMES;
}

export function getBrandVariableMap(
  locale: string,
  now: Date = new Date()
): Record<ReservedBrandVariableName, string> {
  return {
    productName: resolveLocalizedValue(BRAND_PROFILE.productName, locale),
    projectName: resolveLocalizedValue(BRAND_PROFILE.projectName, locale),
    publicDomain: resolveLocalizedValue(BRAND_PROFILE.publicDomain, locale),
    year: String(now.getFullYear()),
  };
}

export function getProtectedTerms(locale?: string): string[] {
  const terms = new Set<string>(BRAND_PROFILE.protectedTerms);

  collectBrandValues(BRAND_PROFILE.productName).forEach(term =>
    terms.add(term)
  );
  collectBrandValues(BRAND_PROFILE.projectName).forEach(term =>
    terms.add(term)
  );
  collectBrandValues(BRAND_PROFILE.publicDomain).forEach(term =>
    terms.add(term)
  );

  if (locale) {
    terms.add(resolveLocalizedValue(BRAND_PROFILE.productName, locale));
    terms.add(resolveLocalizedValue(BRAND_PROFILE.projectName, locale));
    terms.add(resolveLocalizedValue(BRAND_PROFILE.publicDomain, locale));
  }

  return Array.from(terms).filter(Boolean);
}

export function resolveReservedVariables(
  text: string,
  locale: string,
  now: Date = new Date()
): string {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  const variableMap = getBrandVariableMap(locale, now);

  return text.replace(/\{(\w+)\}/g, (match, variableName) => {
    if (variableName in variableMap) {
      return variableMap[variableName as ReservedBrandVariableName];
    }

    return match;
  });
}

export function resolveReservedVariablesDeep<T>(
  value: T,
  locale: string,
  now: Date = new Date()
): T {
  if (typeof value === 'string') {
    return resolveReservedVariables(value, locale, now) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item =>
      resolveReservedVariablesDeep(item, locale, now)
    ) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    result[key] = resolveReservedVariablesDeep(childValue, locale, now);
  }

  return result as T;
}
