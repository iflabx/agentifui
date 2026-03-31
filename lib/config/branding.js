'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.RESERVED_BRAND_VARIABLE_NAMES = void 0;
exports.getReservedVariableNames = getReservedVariableNames;
exports.getBrandVariableMap = getBrandVariableMap;
exports.getProtectedTerms = getProtectedTerms;
exports.resolveReservedVariables = resolveReservedVariables;
exports.resolveReservedVariablesDeep = resolveReservedVariablesDeep;

exports.RESERVED_BRAND_VARIABLE_NAMES = [
  'productName',
  'projectName',
  'publicDomain',
  'year',
];

const BRAND_PROFILE = {
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveLocalizedValue(value, locale) {
  if (value.locales && locale in value.locales) {
    const localized = value.locales[locale];
    if (localized) {
      return localized;
    }
  }

  return value.default;
}

function collectBrandValues(value) {
  const values = [value.default];

  if (value.locales) {
    values.push(...Object.values(value.locales));
  }

  return values.filter(Boolean);
}

function getReservedVariableNames() {
  return exports.RESERVED_BRAND_VARIABLE_NAMES;
}

function getBrandVariableMap(locale, now = new Date()) {
  return {
    productName: resolveLocalizedValue(BRAND_PROFILE.productName, locale),
    projectName: resolveLocalizedValue(BRAND_PROFILE.projectName, locale),
    publicDomain: resolveLocalizedValue(BRAND_PROFILE.publicDomain, locale),
    year: String(now.getFullYear()),
  };
}

function getProtectedTerms(locale) {
  const terms = new Set(BRAND_PROFILE.protectedTerms);

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

function resolveReservedVariables(text, locale, now = new Date()) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  const variableMap = getBrandVariableMap(locale, now);

  return text.replace(/\{(\w+)\}/g, (match, variableName) => {
    if (variableName in variableMap) {
      return variableMap[variableName];
    }

    return match;
  });
}

function resolveReservedVariablesDeep(value, locale, now = new Date()) {
  if (typeof value === 'string') {
    return resolveReservedVariables(value, locale, now);
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveReservedVariablesDeep(item, locale, now));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};

  for (const [key, childValue] of Object.entries(value)) {
    result[key] = resolveReservedVariablesDeep(childValue, locale, now);
  }

  return result;
}
