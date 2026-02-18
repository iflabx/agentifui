import { STORAGE_UPLOAD_POLICIES } from '@lib/shared/storage-upload-policy';
import { PageSection } from '@lib/types/about-page-components';

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
  ...STORAGE_UPLOAD_POLICIES['content-images'].allowedMimeTypes,
] as const;

/**
 * Maximum file size in bytes (10MB)
 */
const MAX_FILE_SIZE = STORAGE_UPLOAD_POLICIES['content-images'].maxBytes;

/**
 * Storage bucket name for content images
 */
const BUCKET_NAME = 'content-images';
const STORAGE_LEGACY_RELAY_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  (process.env.NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED || '')
    .trim()
    .toLowerCase()
);

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

async function runLegacyRelayUpload(
  file: File,
  userId: string
): Promise<ContentImageUploadResult> {
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

async function runCommitUpload(
  userId: string,
  path: string
): Promise<ContentImageUploadResult> {
  const response = await fetch('/api/internal/storage/content-images', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, path }),
  });

  const payload = (await response.json()) as {
    success: boolean;
    url?: string;
    path?: string;
    error?: string;
  };

  if (!response.ok || !payload.success || !payload.path || !payload.url) {
    throw new Error(payload.error || 'Failed to commit content image upload');
  }

  return {
    url: payload.url,
    path: payload.path,
  };
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

  try {
    const presignResponse = await fetch(
      '/api/internal/storage/content-images/presign',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      }
    );

    const presignPayload = (await presignResponse.json()) as {
      success: boolean;
      uploadUrl?: string;
      path?: string;
      error?: string;
    };

    if (
      !presignResponse.ok ||
      !presignPayload.success ||
      !presignPayload.uploadUrl ||
      !presignPayload.path
    ) {
      throw new Error(presignPayload.error || 'Failed to create upload URL');
    }

    const uploadResponse = await fetch(presignPayload.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `Content image direct upload failed with status ${uploadResponse.status}`
      );
    }

    return runCommitUpload(userId, presignPayload.path);
  } catch (presignError) {
    if (!STORAGE_LEGACY_RELAY_ENABLED) {
      throw presignError instanceof Error
        ? presignError
        : new Error('Upload failed');
    }

    console.warn(
      '[ContentImageUpload] presign flow failed, fallback to legacy relay upload:',
      presignError
    );
    return runLegacyRelayUpload(file, userId);
  }
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
