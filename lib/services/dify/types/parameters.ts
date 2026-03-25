export interface DifyNumberInputControl {
  label: string;
  variable: string;
  required: boolean;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
}

export interface DifyTextInputControl {
  label: string;
  variable: string;
  required: boolean;
  max_length?: number;
  default: string;
}

export interface DifyParagraphControl {
  label: string;
  variable: string;
  required: boolean;
  default: string;
}

export interface DifySelectControl {
  label: string;
  variable: string;
  required: boolean;
  default: string;
  options: string[];
}

export interface DifyFileInputControl {
  label: string;
  variable: string;
  required: boolean;
  default?: File[];
  number_limits?: number;
  allowed_file_types?: string[];
  max_file_size_mb?: number;
}

export interface DifyUserInputFormItem {
  'text-input'?: DifyTextInputControl;
  number?: DifyNumberInputControl;
  paragraph?: DifyParagraphControl;
  select?: DifySelectControl;
  file?: DifyFileInputControl;
  'file-list'?: DifyFileInputControl;
}

export interface DifyImageUploadConfig {
  enabled: boolean;
  number_limits: number;
  transfer_methods: ('remote_url' | 'local_file')[];
}

export interface DifyDocumentUploadConfig {
  enabled: boolean;
  number_limits: number;
  transfer_methods: ('remote_url' | 'local_file')[];
}

export interface DifyAudioUploadConfig {
  enabled: boolean;
  number_limits: number;
  transfer_methods: ('remote_url' | 'local_file')[];
}

export interface DifyVideoUploadConfig {
  enabled: boolean;
  number_limits: number;
  transfer_methods: ('remote_url' | 'local_file')[];
}

export interface DifyOtherUploadConfig {
  enabled: boolean;
  number_limits: number;
  transfer_methods: ('remote_url' | 'local_file')[];
  custom_extensions?: string[];
}

export interface DifyFileUploadConfig {
  enabled?: boolean;
  allowed_file_types?: string[];
  allowed_file_extensions?: string[];
  allowed_file_upload_methods?: string[];
  max_file_size_mb?: number;
  number_limits?: number;
  max_files?: number;
  file_count_limit?: number;
  image?: DifyImageUploadConfig;
  document?: DifyDocumentUploadConfig;
  audio?: DifyAudioUploadConfig;
  video?: DifyVideoUploadConfig;
  other?: DifyOtherUploadConfig;
}

export interface DifySystemParameters {
  file_size_limit: number;
  image_file_size_limit: number;
  audio_file_size_limit: number;
  video_file_size_limit: number;
}

export interface DifySuggestedQuestionsAfterAnswer {
  enabled: boolean;
}

export interface DifySpeechToText {
  enabled: boolean;
}

export interface DifyTextToSpeech {
  enabled: boolean;
  voice?: string;
  language?: string;
  autoPlay?: 'enabled' | 'disabled';
}

export interface DifyRetrieverResourceConfig {
  enabled: boolean;
}

export interface DifyAnnotationReply {
  enabled: boolean;
}

export interface DifyAppParametersResponse {
  opening_statement: string;
  suggested_questions: string[];
  suggested_questions_after_answer: DifySuggestedQuestionsAfterAnswer;
  speech_to_text: DifySpeechToText;
  text_to_speech: DifyTextToSpeech;
  retriever_resource: DifyRetrieverResourceConfig;
  annotation_reply: DifyAnnotationReply;
  user_input_form: DifyUserInputFormItem[];
  file_upload: DifyFileUploadConfig;
  system_parameters: DifySystemParameters;
}
