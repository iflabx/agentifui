export type AppDiagnosticCapability =
  'text' | 'inputForm' | 'humanInput' | 'results';

export interface AppDiagnosticResult {
  status: 'success' | 'unsupported' | 'error';
  code:
    | 'connected'
    | 'invalidConfiguration'
    | 'credentialsRequired'
    | 'authenticationFailed'
    | 'timeout'
    | 'unavailable'
    | 'unsupported'
    | 'incompatible'
    | 'resultConfigurationMismatch'
    | 'resultsUnavailable';
  capabilities: AppDiagnosticCapability[];
  resultsPaused?: boolean;
}
