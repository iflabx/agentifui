'use client';

import { cn } from '@lib/utils';
import { getAvatarBgColor, getInitials } from '@lib/utils/avatar';

import React, { useState } from 'react';

import { useTranslations } from 'next-intl';

// Unified user avatar component interface
// Supports image avatar and automatically generated avatar, automatically handling loading failure
interface UserAvatarProps {
  // User information
  avatarUrl?: string | null;
  userName: string;

  // Style options
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;

  // Other attributes
  alt?: string;

  // Optional click event
  onClick?: () => void;
}

// Size preset
const sizeClasses = {
  xs: 'h-6 w-6 text-xs',
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

function getStorageAvatarPath(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null;
  try {
    const match = new URL(avatarUrl).pathname.match(
      /\/avatars\/(user-[^/]+\/[^/]+)$/
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function UserAvatar({
  avatarUrl,
  userName,
  size = 'md',
  className,
  alt,
  onClick,
}: UserAvatarProps) {
  const t = useTranslations('components.ui.userAvatar');

  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [signedAvatar, setSignedAvatar] = useState<{
    source: string;
    url: string;
  } | null>(null);
  const storagePath = getStorageAvatarPath(avatarUrl);

  // Handle image loading failure
  const handleImageError = () => {
    setFailedAvatar(avatarUrl || null);
  };

  React.useEffect(() => {
    if (!storagePath || !avatarUrl) return;
    const controller = new AbortController();
    const loadAvatar = async () => {
      try {
        const response = await fetch(
          `/api/internal/storage/avatar/presign?path=${encodeURIComponent(storagePath)}`,
          { credentials: 'include', signal: controller.signal }
        );
        if (!response.ok) throw new Error('Avatar download is unavailable');
        const payload = await response.json();
        if (!payload.success || typeof payload.downloadUrl !== 'string') {
          throw new Error('Invalid avatar download response');
        }
        if (!controller.signal.aborted) {
          setSignedAvatar({ source: avatarUrl, url: payload.downloadUrl });
        }
      } catch {
        if (!controller.signal.aborted) setFailedAvatar(avatarUrl);
      }
    };
    void loadAvatar();
    return () => controller.abort();
  }, [avatarUrl, storagePath]);

  // Determine whether the image should be displayed
  const imageUrl = storagePath
    ? signedAvatar && signedAvatar.source === avatarUrl
      ? signedAvatar.url
      : null
    : avatarUrl;
  const shouldShowImage = imageUrl && failedAvatar !== avatarUrl;

  // Generate alt text
  const altText = alt || `${userName}${t('alt')}`;

  // Base CSS class
  const baseClasses = cn(
    'rounded-full object-cover transition-all duration-200',
    sizeClasses[size],
    onClick && 'cursor-pointer',
    className
  );

  if (shouldShowImage) {
    return (
      <img
        src={imageUrl}
        alt={altText}
        className={baseClasses}
        onClick={onClick}
        onError={handleImageError}
      />
    );
  }

  // Display automatically generated avatar
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full font-medium text-white',
        sizeClasses[size],
        onClick && 'cursor-pointer',
        className
      )}
      style={{
        backgroundColor: getAvatarBgColor(userName),
      }}
      onClick={onClick}
    >
      {getInitials(userName)}
    </div>
  );
}
