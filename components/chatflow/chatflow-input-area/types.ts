import type { DifyUserInputFormItem } from '@lib/services/dify/types';

export type ChatflowFormData = Record<string, unknown>;

export type UploadPayloadFile = {
  file?: unknown;
  upload_file_id?: unknown;
} & Record<string, unknown>;

export interface ChatflowFormConfigResult {
  hasFormConfig: boolean;
  initialFormData: ChatflowFormData;
  userInputForm: DifyUserInputFormItem[];
}
