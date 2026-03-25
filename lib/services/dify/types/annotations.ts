import type {
  DifyAsyncJobResponse,
  DifyAsyncJobStatusResponse,
} from './shared';

export interface DifyAnnotationItem {
  id: string;
  question: string;
  answer: string;
  hit_count: number;
  created_at: number;
}

export interface GetDifyAnnotationsParams {
  page?: number;
  limit?: number;
}

export interface DifyAnnotationListResponse {
  data: DifyAnnotationItem[];
  has_more: boolean;
  limit: number;
  total: number;
  page: number;
}

export interface CreateDifyAnnotationRequest {
  question: string;
  answer: string;
}

export type CreateDifyAnnotationResponse = DifyAnnotationItem;

export interface UpdateDifyAnnotationRequest {
  question: string;
  answer: string;
}

export type UpdateDifyAnnotationResponse = DifyAnnotationItem;

export type DeleteDifyAnnotationResponse = void;

export type DifyAnnotationReplyAction = 'enable' | 'disable';

export interface InitialDifyAnnotationReplySettingsRequest {
  embedding_provider_name?: string | null;
  embedding_model_name?: string | null;
  score_threshold: number;
}

export type { DifyAsyncJobResponse, DifyAsyncJobStatusResponse };
