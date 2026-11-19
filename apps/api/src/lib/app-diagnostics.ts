import type { AppDiagnosticResult } from '@agentifui/shared';

import { requireHumanInputCapabilities } from './langchain/human-input';
import {
  LangChainUpstreamError,
  getCapabilities,
  supportsResultArtifacts,
} from './langchain/transport';

export interface DiagnosticConfig {
  backend: 'dify' | 'langchain';
  baseUrl: string;
  apiKey: string;
  assistantId?: string;
  resultProfileEnabled?: boolean;
  humanInput?: boolean;
}

export function diagnosticFailure(error: unknown): AppDiagnosticResult {
  let code: AppDiagnosticResult['code'] = 'unavailable';
  if (error instanceof LangChainUpstreamError) {
    if (error.code === 'INVALID_REQUEST') code = 'invalidConfiguration';
    else if (error.code === 'UPSTREAM_TIMEOUT') code = 'timeout';
    else if (error.status === 401 || error.status === 403)
      code = 'authenticationFailed';
    else if (error.status === 404 || error.status === 405) code = 'unsupported';
    else if (error.code === 'UPSTREAM_PROTOCOL_ERROR') code = 'incompatible';
  }
  return {
    status: code === 'unsupported' ? 'unsupported' : 'error',
    code,
    capabilities: [],
  };
}

async function readDifyParameters(config: DiagnosticConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/+$/, '')}/parameters`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        redirect: 'error',
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', response.status);
    }
    if (!response.body)
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const abort = () => void reader?.cancel().catch(() => undefined);
    controller.signal.addEventListener('abort', abort, { once: true });
    while (true) {
      const next = await reader.read();
      if (controller.signal.aborted)
        throw new LangChainUpstreamError('UPSTREAM_TIMEOUT');
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 256 * 1024)
        throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
      chunks.push(next.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !Array.isArray((data as Record<string, unknown>).user_input_form)
    )
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    return data as { user_input_form: unknown[] };
  } catch (error) {
    if (controller.signal.aborted)
      throw new LangChainUpstreamError('UPSTREAM_TIMEOUT');
    if (error instanceof SyntaxError)
      throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
    throw error;
  } finally {
    clearTimeout(timeout);
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    controller.abort();
  }
}

export async function diagnoseApp(
  config: DiagnosticConfig
): Promise<AppDiagnosticResult> {
  try {
    if (config.backend === 'dify') {
      const params = await readDifyParameters(config);
      return {
        status: 'success',
        code: 'connected',
        capabilities: params.user_input_form.length ? ['inputForm'] : [],
      };
    }
    if (config.humanInput) {
      await requireHumanInputCapabilities(config);
      return {
        status: 'success',
        code: 'connected',
        capabilities: ['humanInput'],
        ...(config.resultProfileEnabled === false
          ? { resultsPaused: true }
          : {}),
      };
    }
    const capabilities = await getCapabilities(config);
    if (capabilities.assistantId !== config.assistantId)
      return { status: 'error', code: 'incompatible', capabilities: [] };
    const hasResults = supportsResultArtifacts(capabilities);
    if (config.resultProfileEnabled === true && !hasResults)
      return { status: 'error', code: 'resultsUnavailable', capabilities: [] };
    if (hasResults && config.resultProfileEnabled === undefined)
      return {
        status: 'error',
        code: 'resultConfigurationMismatch',
        capabilities: [],
      };
    return {
      status: 'success',
      code: 'connected',
      capabilities: [
        'text',
        ...(hasResults && config.resultProfileEnabled === true
          ? (['results'] as const)
          : []),
      ],
      ...(config.resultProfileEnabled === false ? { resultsPaused: true } : {}),
    };
  } catch (error) {
    return diagnosticFailure(error);
  }
}
