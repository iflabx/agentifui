export interface DifyFile {
  type: 'image' | 'document' | 'audio' | 'video' | 'custom';
  transfer_method: 'remote_url' | 'local_file';
  url?: string;
  upload_file_id?: string;
}

export interface ChatUploadFile {
  type: string;
  transfer_method: string;
  upload_file_id: string;
  name: string;
  size: number;
  mime_type: string;
}

export interface DifyUsage {
  prompt_tokens?: number;
  prompt_unit_price?: string;
  prompt_price_unit?: string;
  prompt_price?: string;
  completion_tokens?: number;
  completion_unit_price?: string;
  completion_price_unit?: string;
  completion_price?: string;
  total_tokens: number;
  total_price?: string;
  currency?: string;
  latency?: number;
}

export interface DifyRetrieverResource {
  segment_id: string;
  document_id: string;
  document_name: string;
  position: number;
  content: string;
  score?: number;
}

export interface DifyApiError {
  status: number;
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface DifyFileUploadResponse {
  id: string;
  name: string;
  size: number;
  extension: string;
  mime_type: string;
  created_by: string | number;
  created_at: number;
}

export interface DifyFilePreviewOptions {
  as_attachment?: boolean;
}

export interface DifyFilePreviewResponse {
  content: Blob;
  headers: {
    contentType: string;
    contentLength?: number;
    contentDisposition?: string;
    cacheControl?: string;
    acceptRanges?: string;
  };
}

export interface DifyAppInfoResponse {
  name: string;
  description: string;
  tags: string[];
}

export interface DifyWebAppSettingsResponse {
  title: string;
  chat_color_theme: string;
  chat_color_theme_inverted: boolean;
  icon_type: 'emoji' | 'image';
  icon: string;
  icon_background: string;
  icon_url: string | null;
  description: string;
  copyright: string;
  privacy_policy: string;
  custom_disclaimer: string;
  default_language: string;
  show_workflow_steps: boolean;
  use_icon_as_answer_icon: boolean;
}

export interface DifyToolIconDetail {
  background: string;
  content: string;
}

export interface DifyAppMetaResponse {
  tool_icons: Record<string, string | DifyToolIconDetail>;
}

export interface DifyAsyncJobResponse {
  job_id: string;
  job_status: string;
}

export interface DifyAsyncJobStatusResponse {
  job_id: string;
  job_status: string;
  error_msg?: string | null;
}
