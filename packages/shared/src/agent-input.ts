export type InputFileType = 'document' | 'image' | 'audio' | 'video' | 'custom';

export interface AgentAttachmentSlot {
  key: string;
  label: string;
  target: 'files' | 'inputs';
  multiple?: boolean;
  minCount: number;
  maxCount: number;
  methods: ('local_file' | 'remote_url')[];
  allowedTypes: InputFileType[];
  extensions: string[];
  maxBytesByType: Partial<Record<InputFileType, number>>;
}

export interface AgentInputField {
  key: string;
  label: string;
  type: 'text-input' | 'paragraph' | 'number' | 'select';
  required: boolean;
  default?: string | number;
  options?: string[];
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
}

export interface AgentInputCapabilities {
  version: 1;
  status: 'ready' | 'unavailable' | 'unsupported';
  reason?: string;
  mode: 'conversation' | 'task';
  text: { enabled: boolean; required: boolean; target: string };
  fields: AgentInputField[];
  attachmentSlots: AgentAttachmentSlot[];
}

export const INPUT_FILE_EXTENSIONS: Record<InputFileType, readonly string[]> = {
  document: [
    'txt',
    'md',
    'mdx',
    'markdown',
    'pdf',
    'html',
    'xlsx',
    'xls',
    'doc',
    'docx',
    'csv',
    'eml',
    'msg',
    'pptx',
    'ppt',
    'xml',
    'epub',
  ],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
  audio: ['mp3', 'm4a', 'wav', 'amr', 'mpga', 'mpeg'],
  video: ['mp4', 'mov', 'mpeg', 'webm'],
  custom: [],
};

export function inputFileExtension(name: string): string {
  return name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    : '';
}

export function inputFileType(name: string, mime = ''): InputFileType {
  const extension = inputFileExtension(name);
  for (const type of ['image', 'audio', 'video', 'document'] as const) {
    if (
      INPUT_FILE_EXTENSIONS[type].includes(extension) &&
      (type !== 'audio' || extension !== 'mpeg' || !mime.startsWith('video/'))
    )
      return type;
  }
  return 'custom';
}

export function validateInputFile(
  slot: AgentAttachmentSlot,
  file: { name: string; size: number; type?: string }
): string | null {
  if (!slot.methods.includes('local_file') || slot.maxCount === 0)
    return 'INPUT_UPLOAD_DISABLED';
  const extension = inputFileExtension(file.name);
  const type = inputFileType(file.name, file.type);
  const customAllowed =
    slot.allowedTypes.includes('custom') && slot.extensions.includes(extension);
  if (
    (!slot.allowedTypes.includes(type) && !customAllowed) ||
    (slot.extensions.length > 0 && !slot.extensions.includes(extension))
  )
    return 'INPUT_FILE_TYPE';
  const limit =
    slot.maxBytesByType[slot.allowedTypes.includes(type) ? type : 'custom'];
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    limit === undefined ||
    file.size > limit
  )
    return 'INPUT_FILE_SIZE';
  return null;
}

export function inputFileExtensionsForSlot(
  slot: AgentAttachmentSlot
): string[] {
  const candidates = slot.extensions.length
    ? slot.extensions
    : slot.allowedTypes.flatMap(type => INPUT_FILE_EXTENSIONS[type]);
  return [...new Set(candidates)].filter(extension => {
    const file = { name: `file.${extension}`, size: 0 };
    return (
      validateInputFile(slot, file) === null ||
      (extension === 'mpeg' &&
        validateInputFile(slot, { ...file, type: 'video/mpeg' }) === null)
    );
  });
}

export function validateInputFileCount(
  slot: AgentAttachmentSlot,
  count: number
): string | null {
  if (!Number.isSafeInteger(count) || count < slot.minCount)
    return 'INPUT_FILES_REQUIRED';
  return count > slot.maxCount ? 'INPUT_TOO_MANY_FILES' : null;
}
