'use client';

import { PropertyField } from '@components/admin/content/context-menu/property-field';
import { ImageUploadDialog } from '@components/admin/content/image-upload-dialog';
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import type { ComponentInstance } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import { Trash2, X } from 'lucide-react';

import React, { useEffect, useRef, useState } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  component: ComponentInstance | null;
  onPropsChange: (newProps: Record<string, unknown>) => void;
  onDelete: (componentId: string) => void;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  component,
  onPropsChange,
  onDelete,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!modalRef.current) {
      return;
    }

    const modal = modalRef.current;
    const rect = modal.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextX = x;
    let nextY = y;

    if (x + rect.width > viewportWidth) {
      nextX = viewportWidth - rect.width - 20;
    }
    if (y + rect.height > viewportHeight) {
      nextY = viewportHeight - rect.height - 20;
    }
    if (nextX < 20) {
      nextX = 20;
    }
    if (nextY < 20) {
      nextY = 20;
    }

    setPosition({ x: nextX, y: nextY });
  }, [x, y]);

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  useEffect(() => {
    let isMounted = true;

    const fetchUserId = async () => {
      const user = await getCurrentUser();
      if (isMounted && user) {
        setUserId(user.id);
      }
    };

    void fetchUserId();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDelete = () => {
    if (!component) {
      return;
    }

    onDelete(component.id);
    onClose();
  };

  if (!component) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      <div
        ref={modalRef}
        className={cn(
          'fixed z-50 max-h-96 w-80 overflow-y-auto',
          'rounded-lg border shadow-lg',
          'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
        )}
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <div className="border-b border-stone-200 p-3 dark:border-stone-700">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-stone-900 capitalize dark:text-stone-100">
              {component.type} Properties
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                className="flex h-6 w-6 items-center justify-center rounded p-0 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50"
                title="Delete Component"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded p-0 text-stone-500 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700"
                title="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-3 p-3">
          {Object.entries(component.props).map(([key, value]) => (
            <PropertyField
              key={key}
              component={component}
              propertyKey={key}
              value={value}
              userId={userId}
              onOpenUpload={() => setIsUploadDialogOpen(true)}
              onPropsChange={onPropsChange}
            />
          ))}
          {component.type === 'button' && !component.props.secondaryButton && (
            <PropertyField
              component={component}
              propertyKey="secondaryButton"
              value={undefined}
              userId={userId}
              onOpenUpload={() => setIsUploadDialogOpen(true)}
              onPropsChange={onPropsChange}
            />
          )}
        </div>
      </div>

      {userId && (
        <ImageUploadDialog
          isOpen={isUploadDialogOpen}
          onClose={() => setIsUploadDialogOpen(false)}
          onUploadSuccess={(url, path) => {
            onPropsChange({
              ...component.props,
              src: url,
              _imagePath: path,
            });
          }}
          userId={userId}
        />
      )}
    </>
  );
};
