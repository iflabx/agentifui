'use client';

import { InstanceFilterSelector } from '@components/admin/api-config/instance-filter-selector';
import { SearchInput } from '@components/ui';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useApiConfigStore } from '@lib/stores/api-config-store';
import { ServiceInstance } from '@lib/types/database';
import { cn } from '@lib/utils';
import {
  Bot,
  Database,
  FileText,
  Globe,
  Loader2,
  MessageSquare,
  Plus,
  Settings,
  Star,
  StarOff,
  Trash2,
  Workflow,
} from 'lucide-react';

import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface ApiConfigLayoutProps {
  children: ReactNode;
}

// get app type icon based on Dify app type
const getAppTypeIcon = (difyAppType?: string) => {
  switch (difyAppType) {
    case 'chatbot':
      return MessageSquare;
    case 'agent':
      return Bot;
    case 'chatflow':
      return Workflow;
    case 'workflow':
      return Settings;
    case 'text-generation':
      return FileText;
    default:
      return Globe;
  }
};

export default function ApiConfigLayout({ children }: ApiConfigLayoutProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const t = useTranslations('pages.admin.apiConfig.layout');
  const tDebug = useTranslations('debug');

  const {
    serviceInstances: instances,
    providers,
    isLoading: instancesLoading,
    loadConfigData: loadInstances,
    deleteAppInstance: deleteInstance,
    setDefaultInstance,
  } = useApiConfigStore();

  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [instanceToDelete, setInstanceToDelete] =
    useState<ServiceInstance | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // get filter state from URL query params
  const [filterProviderId, setFilterProviderId] = useState<string | null>(
    () => {
      return searchParams?.get('provider') || null;
    }
  );
  const [searchTerm, setSearchTerm] = useState<string>('');

  // initialize data loading
  useEffect(() => {
    if (!hasInitiallyLoaded) {
      loadInstances().finally(() => {
        setHasInitiallyLoaded(true);
      });
    }
  }, [hasInitiallyLoaded, loadInstances]);

  // handle filter change and sync URL
  const handleFilterChange = (providerId: string | null) => {
    // if value is not changed, return
    if (providerId === filterProviderId) return;

    setFilterProviderId(providerId);

    // immediately update URL query params, avoid delay
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (providerId) {
      params.set('provider', providerId);
    } else {
      params.delete('provider');
    }

    const newUrl = `${pathname}?${params.toString()}`;
    router.replace(newUrl, { scroll: false });

    // notify page component of filter state change, for auto-setting provider when creating app
    window.dispatchEvent(
      new CustomEvent('filterChanged', {
        detail: { providerId },
      })
    );
  };

  // listen to URL change and sync filter state (optimized to avoid loop)
  useEffect(() => {
    const urlProviderId = searchParams?.get('provider') || null;
    // only update when truly different, avoid loop
    if (urlProviderId !== filterProviderId) {
      setFilterProviderId(urlProviderId);
      // sync notification to page component
      window.dispatchEvent(
        new CustomEvent('filterChanged', {
          detail: { providerId: urlProviderId },
        })
      );
    }
  }, [searchParams, filterProviderId]);

  // 🎯 filter instances based on filter conditions
  const filteredInstances = useMemo(() => {
    let filtered = instances;

    // Filter by provider
    if (filterProviderId) {
      filtered = filtered.filter(
        instance => instance.provider_id === filterProviderId
      );
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(instance => {
        const provider = providers.find(p => p.id === instance.provider_id);
        const difyAppType = instance.config?.app_metadata?.dify_apptype || '';

        return (
          instance.display_name?.toLowerCase().includes(searchLower) ||
          instance.instance_id?.toLowerCase().includes(searchLower) ||
          instance.description?.toLowerCase().includes(searchLower) ||
          difyAppType.toLowerCase().includes(searchLower) ||
          provider?.name?.toLowerCase().includes(searchLower)
        );
      });
    }

    return filtered;
  }, [instances, filterProviderId, searchTerm, providers]);

  const handleSetDefaultInstance = useCallback(
    async (instanceId: string) => {
      // add debug info
      console.log(tDebug('setDefaultApp'), instanceId);
      console.log(
        tDebug('currentInstances'),
        instances.map(inst => ({
          id: inst.id,
          instance_id: inst.instance_id,
          display_name: inst.display_name,
        }))
      );

      // fix: use database ID to find instance
      const instanceToSet = instances.find(inst => inst.id === instanceId);
      if (!instanceToSet) {
        console.error(tDebug('instanceNotFound'), instanceId);
        alert(t('instanceNotFoundForDefault'));
        return;
      }

      console.log(tDebug('foundInstance'), instanceToSet);

      if (instanceToSet.is_default) {
        return; // already a default app, no need to operate
      }

      if (
        !confirm(
          t('setDefaultConfirm', {
            name: instanceToSet.display_name || 'this app',
          })
        )
      ) {
        return;
      }

      setIsProcessing(true);
      try {
        await setDefaultInstance(instanceToSet.id);

        // notify page component that default app is changed
        window.dispatchEvent(
          new CustomEvent('defaultInstanceChanged', {
            detail: { instanceId },
          })
        );
      } catch (error) {
        console.error(tDebug('setDefaultFailed'), error);
        alert(t('setDefaultFailed'));
      } finally {
        setIsProcessing(false);
      }
    },
    [instances, t, tDebug, setDefaultInstance]
  );

  const handleDeleteInstance = (instance: ServiceInstance) => {
    setInstanceToDelete(instance);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!instanceToDelete) return;

    setIsDeleting(true);
    try {
      await deleteInstance(instanceToDelete.id);
      setShowDeleteDialog(false);
      setInstanceToDelete(null);
    } catch (error) {
      console.error('Failed to delete instance:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // listen to page component's state change, fully sync page's form state
  useEffect(() => {
    const handleAddFormToggled = (event: CustomEvent) => {
      const { showAddForm: newShowAddForm, selectedInstance } = event.detail;
      setShowAddForm(newShowAddForm);
      // when showing add form, clear all selected state
      // when showing edit form, set corresponding selected state
      if (newShowAddForm) {
        setSelectedInstanceId(null);
      } else if (selectedInstance) {
        setSelectedInstanceId(selectedInstance.instance_id);
      } else {
        setSelectedInstanceId(null);
      }
    };

    const handleSetInstanceAsDefault = (event: CustomEvent) => {
      const { instanceId } = event.detail;
      handleSetDefaultInstance(instanceId);
    };

    const handleDirectSetDefault = (event: CustomEvent) => {
      const { instanceId } = event.detail;
      // unified logic: directly call the same function
      handleSetDefaultInstance(instanceId);
    };

    const handleReloadInstances = () => {
      // reload service instance data
      loadInstances();
    };

    const handleReloadProviders = () => {
      // reload providers data
      loadInstances(); // this will also load providers and instances
    };

    window.addEventListener(
      'addFormToggled',
      handleAddFormToggled as EventListener
    );
    window.addEventListener(
      'setInstanceAsDefault',
      handleSetInstanceAsDefault as EventListener
    );
    window.addEventListener(
      'directSetDefault',
      handleDirectSetDefault as EventListener
    );
    window.addEventListener('reloadInstances', handleReloadInstances);
    window.addEventListener('reloadProviders', handleReloadProviders);

    return () => {
      window.removeEventListener(
        'addFormToggled',
        handleAddFormToggled as EventListener
      );
      window.removeEventListener(
        'setInstanceAsDefault',
        handleSetInstanceAsDefault as EventListener
      );
      window.removeEventListener(
        'directSetDefault',
        handleDirectSetDefault as EventListener
      );
      window.removeEventListener('reloadInstances', handleReloadInstances);
      window.removeEventListener('reloadProviders', handleReloadProviders);
    };
  }, [handleSetDefaultInstance, loadInstances]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar: fixed width, starts from below admin navigation */}
      <div
        className={cn(
          'fixed left-16 z-40 flex w-80 flex-shrink-0 flex-col',
          'top-12 bottom-0'
        )}
      >
        {/* header: no extra top spacing, because it starts from the correct position */}
        <div
          className={cn(
            'flex-shrink-0 border-b border-stone-200 bg-stone-100 p-2 dark:border-stone-700 dark:bg-stone-800'
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            {/* Use new filter selector to replace original title */}
            <InstanceFilterSelector
              providers={providers}
              selectedProviderId={filterProviderId}
              onFilterChange={handleFilterChange}
              instanceCount={filteredInstances.length}
              isLoading={!hasInitiallyLoaded && instancesLoading}
            />

            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('toggleAddForm'));
              }}
              className={cn(
                'cursor-pointer rounded-lg p-1.5 transition-all duration-200',
                'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                showAddForm
                  ? 'bg-stone-400 text-white focus:ring-stone-300 dark:bg-stone-500 dark:text-stone-100 dark:focus:ring-stone-400'
                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300 hover:text-stone-900 focus:ring-stone-400 dark:bg-stone-600 dark:text-stone-200 dark:hover:bg-stone-500 dark:hover:text-stone-100 dark:focus:ring-stone-500'
              )}
            >
              <Plus
                className={cn(
                  'h-3.5 w-3.5 transition-transform duration-200',
                  showAddForm && 'rotate-45'
                )}
              />
            </button>
          </div>

          {/* Search input */}
          <SearchInput
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder={t('searchPlaceholder')}
          />
        </div>

        {/* list: independent scroll area */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            'bg-stone-100 dark:bg-stone-800'
          )}
        >
          {!hasInitiallyLoaded && instancesLoading ? (
            <div className="p-4 text-center">
              <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-stone-400" />
              <p
                className={cn(
                  'font-serif text-sm',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {t('loading')}
              </p>
            </div>
          ) : filteredInstances.length === 0 ? (
            <div className="p-4 text-center">
              <Database className="mx-auto mb-3 h-12 w-12 text-stone-400" />
              <p
                className={cn(
                  'font-serif text-sm',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {filterProviderId
                  ? t('noInstancesForProvider')
                  : t('noInstances')}
              </p>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('toggleAddForm'));
                }}
                className={cn(
                  'mt-2 cursor-pointer font-serif text-sm text-stone-600 transition-colors hover:text-stone-800 dark:text-stone-300 dark:hover:text-stone-100'
                )}
              >
                {t('addFirstApp')}
              </button>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {filteredInstances.map(instance => {
                const difyAppType = instance.config?.app_metadata?.dify_apptype;
                const AppIcon = getAppTypeIcon(difyAppType);
                const provider = providers.find(
                  p => p.id === instance.provider_id
                );

                return (
                  <div
                    key={instance.instance_id}
                    className={cn(
                      'group relative cursor-pointer rounded-xl p-3',
                      'transition-all duration-200 ease-in-out',
                      'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                      'border backdrop-blur-sm',
                      // fixed height to keep consistency
                      'flex h-20 flex-col justify-between',
                      selectedInstanceId === instance.instance_id
                        ? 'border-stone-400 bg-white shadow-lg focus:ring-stone-300 dark:bg-stone-700/80 dark:shadow-xl dark:focus:ring-stone-400'
                        : 'border-stone-300/80 bg-white/90 hover:border-stone-400 hover:bg-white hover:shadow-md focus:ring-stone-300 dark:border-stone-600/70 dark:bg-stone-800/70 dark:hover:border-stone-500 dark:hover:bg-stone-700/80 dark:hover:shadow-lg dark:focus:ring-stone-500'
                    )}
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent('selectInstance', {
                          detail: instance,
                        })
                      );
                    }}
                    tabIndex={0}
                  >
                    {/* main content area */}
                    <div className="flex h-full items-start justify-between">
                      <div className="flex h-full min-w-0 flex-1 flex-col justify-between">
                        {/* top: app name and icon */}
                        <div className="flex items-center gap-2">
                          <AppIcon
                            className={cn(
                              'h-4 w-4 flex-shrink-0',
                              'text-stone-600 dark:text-stone-300'
                            )}
                          />
                          <h3
                            className={cn(
                              'truncate font-serif text-sm font-medium',
                              'text-stone-900 dark:text-stone-100'
                            )}
                          >
                            {instance.display_name}
                          </h3>

                          {/* default app label */}
                          {instance.is_default && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 font-serif text-xs font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/30 dark:text-amber-300'
                              )}
                            >
                              <Star className="h-2.5 w-2.5" />
                              {t('defaultApp')}
                            </span>
                          )}
                        </div>

                        {/* bottom: type and provider info (low profile display) */}
                        <div className="flex items-center gap-2 text-xs">
                          {/* app type original value */}
                          {difyAppType && (
                            <span
                              className={cn('font-serif', 'text-stone-500')}
                            >
                              {difyAppType}
                            </span>
                          )}

                          {/* separator */}
                          {difyAppType && provider && (
                            <span className={cn('text-stone-500')}>·</span>
                          )}

                          {/* provider info */}
                          {provider && (
                            <span
                              className={cn('font-serif', 'text-stone-500')}
                            >
                              {provider.name}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* right operation buttons */}
                      <div className="ml-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {/* set default app button */}
                        {!instance.is_default && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleSetDefaultInstance(instance.id);
                            }}
                            disabled={isProcessing}
                            className={cn(
                              'cursor-pointer rounded-lg p-1.5 transition-colors',
                              'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                              'text-stone-500 hover:bg-amber-100 hover:text-amber-700 focus:ring-amber-300 dark:text-stone-400 dark:hover:bg-stone-600 dark:hover:text-amber-300 dark:focus:ring-amber-500',
                              isProcessing && 'cursor-not-allowed opacity-50'
                            )}
                            title={t('setAsDefault')}
                          >
                            <StarOff className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* delete button */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteInstance(instance);
                          }}
                          disabled={isProcessing || instance.is_default}
                          className={cn(
                            'rounded-lg p-1.5 transition-colors',
                            'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                            instance.is_default
                              ? 'cursor-not-allowed text-stone-400 opacity-30'
                              : cn(
                                  'cursor-pointer text-stone-500 hover:bg-red-100 hover:text-red-700 focus:ring-red-300 dark:text-stone-400 dark:hover:bg-red-900/40 dark:hover:text-red-300 dark:focus:ring-red-500'
                                ),
                            isProcessing &&
                              !instance.is_default &&
                              'cursor-not-allowed opacity-50'
                          )}
                          title={
                            instance.is_default
                              ? t('defaultAppCannotDelete')
                              : t('delete')
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Divider: full-height vertical line starting from below admin navigation */}
      <div
        className={cn(
          'fixed left-96 z-40 w-px',
          'top-12 bottom-0',
          'bg-stone-200 dark:bg-stone-700'
        )}
      ></div>

      {/* Right content area: adjust left margin to accommodate fixed sidebar */}
      <div className="ml-80 h-full flex-1 overflow-hidden pl-px">
        {children}
      </div>

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => !isDeleting && setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        title={t('delete')}
        message={t('deleteConfirm')}
        confirmText={t('delete')}
        variant="danger"
        icon="delete"
        isLoading={isDeleting}
      />
    </div>
  );
}
