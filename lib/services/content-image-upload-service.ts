import { PageSection } from '@lib/types/about-page-components';
import { v4 as uuidv4 } from 'uuid';

/**
 * Result type for content image upload
 */
export interface ContentImageUploadResult {
  url: string;
  path: string;
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Allowed image MIME types for content images
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

/**
 * MIME type to file extension mapping
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Maximum file size in bytes (10MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Storage bucket name for content images
 */
const BUCKET_NAME = 'content-images';

/**
 * Validate image file type and size.
 */
export function validateImageFile(file: File): ValidationResult {
  if (
    !ALLOWED_IMAGE_TYPES.includes(
      file.type as (typeof ALLOWED_IMAGE_TYPES)[number]
    )
  ) {
    return {
      valid: false,
      error: `Unsupported file type. Supported formats: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`,
    };
  }

  return { valid: true };
}

/**
 * Generate a unique file path for content image.
 */
export function generateContentImagePath(
  userId: string,
  fileName: string,
  fileType: string
): string {
  const uuid = uuidv4();
  const timestamp = Date.now();
  const extension =
    MIME_TO_EXTENSION[fileType] || fileName.split('.').pop() || 'jpg';
  const safeFileName = `${timestamp}-${uuid}.${extension}`;
  return `user-${userId}/${safeFileName}`;
}

/**
 * Extract file path from storage URL.
 */
export function extractFilePathFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const bucketIndex = pathParts.indexOf(BUCKET_NAME);
    if (bucketIndex !== -1 && bucketIndex < pathParts.length - 1) {
      return pathParts.slice(bucketIndex + 1).join('/');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Upload content image to storage.
 */
export async function uploadContentImage(
  file: File,
  userId: string
): Promise<ContentImageUploadResult> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', userId);

  const response = await fetch('/api/internal/storage/content-images', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const payload = (await response.json()) as {
    success: boolean;
    url?: string;
    path?: string;
    error?: string;
  };

  if (!response.ok || !payload.success || !payload.url || !payload.path) {
    throw new Error(payload.error || 'Upload failed');
  }

  return {
    url: payload.url,
    path: payload.path,
  };
}

/**
 * Delete content image from storage.
 */
export async function deleteContentImage(filePath: string): Promise<void> {
  const response = await fetch('/api/internal/storage/content-images', {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filePath }),
  });

  const payload = (await response.json()) as {
    success: boolean;
    error?: string;
  };

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Delete failed');
  }
}

/**
 * List all content images for a specific user.
 */
export async function listUserContentImages(userId: string): Promise<string[]> {
  const response = await fetch(
    `/api/internal/storage/content-images?userId=${encodeURIComponent(userId)}`,
    {
      method: 'GET',
      credentials: 'include',
    }
  );

  const payload = (await response.json()) as {
    success: boolean;
    files?: string[];
    error?: string;
  };

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to list images');
  }

  return payload.files || [];
}

/**
 * Extract all image paths from page sections.
 */
export function extractImagePathsFromSections(
  sections: PageSection[]
): string[] {
  return sections.flatMap(section =>
    section.columns.flatMap(column =>
      column
        .filter(
          component => component.type === 'image' && component.props._imagePath
        )
        .map(component => component.props._imagePath as string)
    )
  );
}

/**
 * Clean up unused content images for a specific user.
 */
export async function cleanupUnusedImages(
  sections: PageSection[],
  userId: string
): Promise<number> {
  const usedImagePaths = new Set(extractImagePathsFromSections(sections));
  const allImagePaths = await listUserContentImages(userId);
  const unusedImagePaths = allImagePaths.filter(
    path => !usedImagePaths.has(path)
  );

  if (unusedImagePaths.length > 0) {
    await Promise.all(unusedImagePaths.map(path => deleteContentImage(path)));
  }

  return unusedImagePaths.length;
}
