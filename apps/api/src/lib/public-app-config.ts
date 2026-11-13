function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function publicAppConfig(
  config: Record<string, unknown> | null
): Record<string, unknown> {
  if (config?.backend_type !== 'langchain') {
    return config || {};
  }

  const metadata = record(config.app_metadata);
  const appMetadata: Record<string, unknown> = {};
  for (const key of [
    'app_type',
    'model_type',
    'icon_url',
    'brief_description',
  ]) {
    if (typeof metadata[key] === 'string') {
      appMetadata[key] = metadata[key];
    }
  }
  for (const key of ['is_common_model', 'is_marketplace_app']) {
    if (typeof metadata[key] === 'boolean') {
      appMetadata[key] = metadata[key];
    }
  }
  if (Array.isArray(metadata.tags)) {
    appMetadata.tags = metadata.tags.filter(tag => typeof tag === 'string');
  }

  const source = record(config.langchain);
  const langchain: Record<string, unknown> = {};
  if (
    typeof source.assistant_id === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(source.assistant_id)
  ) {
    langchain.assistant_id = source.assistant_id;
  }
  const capabilities = record(source.capabilities);
  const safeCapabilities: Record<string, boolean | 'read-only-summary'> = {};
  for (const key of [
    'text',
    'streaming',
    'history',
    'cancellation',
    'runQuery',
    'files',
    'humanInput',
    'resumableStream',
  ]) {
    if (typeof capabilities[key] === 'boolean') {
      safeCapabilities[key] = capabilities[key];
    }
  }
  if (capabilities.tools === 'read-only-summary') {
    safeCapabilities.tools = 'read-only-summary';
  }
  if (Object.keys(safeCapabilities).length) {
    langchain.capabilities = safeCapabilities;
  }

  return { backend_type: 'langchain', app_metadata: appMetadata, langchain };
}
