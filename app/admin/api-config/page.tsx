'use client';

import { EmptyState } from '@components/admin/api-config/empty-state';
import { InstanceDetailHeader } from '@components/admin/api-config/instance-detail-header';
import { InstanceForm } from '@components/admin/api-config/instance-form';
import { InstanceFormContainer } from '@components/admin/api-config/instance-form-container';
import {
  handleCreateInstance,
  handleUpdateInstance,
} from '@components/admin/api-config/instance-save-handlers';
import { ProviderManagementModal } from '@components/admin/api-config/provider-management';
import { ProviderManagementButton } from '@components/admin/api-config/provider-management-button';
import { useApiConfigEvents } from '@components/admin/api-config/use-api-config-events';
import {
  ServiceInstance,
  useApiConfigStore,
} from '@lib/stores/api-config-store';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

export default function ApiConfigPage() {
  const {
    providers,
    createAppInstance: addInstance,
    updateAppInstance: updateInstance,
  } = useApiConfigStore();
  const tInstanceSaveHandlers = useTranslations(
    'pages.admin.apiConfig.instanceSaveHandlers'
  );

  const [selectedInstance, setSelectedInstance] =
    useState<ServiceInstance | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [currentFilterProviderId, setCurrentFilterProviderId] = useState<
    string | null
  >(null);

  useApiConfigEvents({
    showAddForm,
    selectedInstance,
    setSelectedInstance,
    setShowAddForm,
    setCurrentFilterProviderId,
  });

  const handleClearSelection = () => {
    setSelectedInstance(null);
    setShowAddForm(false);
    window.dispatchEvent(
      new CustomEvent('addFormToggled', {
        detail: {
          showAddForm: false,
          selectedInstance: null,
        },
      })
    );
  };

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('addFormToggled', {
        detail: {
          showAddForm,
          selectedInstance,
        },
      })
    );
  }, [showAddForm, selectedInstance]);

  return (
    <div className="flex h-full flex-col">
      <ProviderManagementButton onClick={() => setShowProviderModal(true)} />

      {showAddForm ? (
        <InstanceFormContainer>
          <InstanceForm
            instance={null}
            isEditing={false}
            defaultProviderId={currentFilterProviderId}
            onSave={data =>
              handleCreateInstance(
                data,
                providers,
                addInstance,
                setIsProcessing,
                handleClearSelection,
                tInstanceSaveHandlers
              )
            }
            onCancel={handleClearSelection}
            isProcessing={isProcessing}
          />
        </InstanceFormContainer>
      ) : selectedInstance ? (
        <InstanceFormContainer>
          <InstanceDetailHeader
            instance={selectedInstance}
            onClose={handleClearSelection}
          />
          <InstanceForm
            instance={selectedInstance}
            isEditing={true}
            onSave={data =>
              handleUpdateInstance(
                selectedInstance,
                data,
                updateInstance,
                setIsProcessing,
                handleClearSelection,
                tInstanceSaveHandlers
              )
            }
            onCancel={handleClearSelection}
            isProcessing={isProcessing}
          />
        </InstanceFormContainer>
      ) : (
        <EmptyState />
      )}

      <ProviderManagementModal
        open={showProviderModal}
        onOpenChange={setShowProviderModal}
        onProviderChange={() => {
          window.dispatchEvent(new CustomEvent('reloadProviders'));
        }}
      />
    </div>
  );
}
