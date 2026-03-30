'use client';

import { AboutEditor } from '@components/admin/content/about-editor';
import { AboutPreview } from '@components/admin/content/about-preview';
import { EditorSkeleton } from '@components/admin/content/editor-skeleton';
import { HomePreviewDynamic } from '@components/admin/content/home-preview-dynamic';
import { PreviewToolbar } from '@components/admin/content/preview-toolbar';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { ResizableSplitPane } from '@components/ui/resizable-split-pane';
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import {
  type SupportedLocale,
  getCurrentLocaleFromCookie,
  getLanguageInfo,
} from '@lib/config/language-config';
import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { clearPageContentCache } from '@lib/hooks/use-page-content';
import { ContentPageService } from '@lib/services/admin/content/translation-service';
import { cleanupUnusedImages } from '@lib/services/content-image-upload-service';
import { useAboutEditorStore } from '@lib/stores/about-editor-store';
import type { AboutTranslationData } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import type { HomeTranslationData } from '@lib/utils/data-migration';
import { toast } from 'sonner';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';

import { ContentFullscreenPreview } from '@/admin/content/fullscreen-preview';
import { ContentManagementHeader } from '@/admin/content/page-header';
import {
  collectAllSections,
  convertAboutTranslationsToHomeTranslations,
  convertHomeTranslationsToAboutTranslations,
  createPageContentFromAboutTranslation,
  createPageContentFromHomeTranslation,
  transformToHomePreviewConfig,
} from '@/admin/content/page-helpers';
import { ContentSaveActions } from '@/admin/content/page-save-actions';

export default function ContentManagementPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('pages.admin.content.page');

  const {
    setPageContent: setRenderedEditorPageContent,
    reset: resetRenderedEditor,
  } = useAboutEditorStore();

  const [activeTab, setActiveTab] = useState<'about' | 'home'>('about');
  const [showPreview, setShowPreview] = useState(true);
  const [previewDevice, setPreviewDevice] = useState<
    'desktop' | 'tablet' | 'mobile'
  >('desktop');
  const [isSaving, setIsSaving] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);
  const [isTranslateConfirmOpen, setIsTranslateConfirmOpen] = useState(false);
  const [isStructureConflictOpen, setIsStructureConflictOpen] = useState(false);

  const [aboutTranslations, setAboutTranslations] = useState<Record<
    SupportedLocale,
    AboutTranslationData
  > | null>(null);
  const [originalAboutTranslations, setOriginalAboutTranslations] =
    useState<Record<SupportedLocale, AboutTranslationData> | null>(null);

  const [homeTranslations, setHomeTranslations] = useState<Record<
    SupportedLocale,
    HomeTranslationData
  > | null>(null);
  const [originalHomeTranslations, setOriginalHomeTranslations] =
    useState<Record<SupportedLocale, HomeTranslationData> | null>(null);
  const [aboutStructureVersion, setAboutStructureVersion] = useState<
    number | null
  >(null);
  const [homeStructureVersion, setHomeStructureVersion] = useState<
    number | null
  >(null);

  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(
    getCurrentLocaleFromCookie()
  );
  const [supportedLocales, setSupportedLocales] = useState<SupportedLocale[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTranslations = async () => {
      setIsLoading(true);
      try {
        if (activeTab === 'about') {
          const response = await ContentPageService.getAboutPageTranslations();
          setAboutTranslations(response.translations);
          setOriginalAboutTranslations(response.translations);
          setAboutStructureVersion(response.structureVersion);
        } else {
          const response = await ContentPageService.getHomePageTranslations();
          setHomeTranslations(response.translations);
          setOriginalHomeTranslations(response.translations);
          setHomeStructureVersion(response.structureVersion);
        }

        if (supportedLocales.length === 0) {
          const locales = ContentPageService.getSupportedLanguages();
          setSupportedLocales(locales);
        }
      } catch (error) {
        console.error(`Failed to load ${activeTab} translations:`, error);
        toast.error(t('messages.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    void loadTranslations();
  }, [activeTab, supportedLocales.length, t]);

  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (tab === 'about' || tab === 'home') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const hasCurrentLocaleChanges = useMemo(() => {
    if (activeTab === 'about') {
      return (
        JSON.stringify(aboutTranslations?.[currentLocale] ?? null) !==
        JSON.stringify(originalAboutTranslations?.[currentLocale] ?? null)
      );
    }

    return (
      JSON.stringify(homeTranslations?.[currentLocale] ?? null) !==
      JSON.stringify(originalHomeTranslations?.[currentLocale] ?? null)
    );
  }, [
    activeTab,
    aboutTranslations,
    currentLocale,
    homeTranslations,
    originalAboutTranslations,
    originalHomeTranslations,
  ]);

  const blockNavigationOnUnsavedChanges = useCallback(() => {
    if (!hasCurrentLocaleChanges) {
      return false;
    }

    toast.warning(t('messages.saveOrResetBeforeSwitch'));
    return true;
  }, [hasCurrentLocaleChanges, t]);

  const handleTabChange = (tab: 'about' | 'home') => {
    if (tab === activeTab) {
      return;
    }
    if (blockNavigationOnUnsavedChanges()) {
      return;
    }
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', tab);
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const handleLocaleChange = (newLocale: SupportedLocale) => {
    if (newLocale === currentLocale) {
      return;
    }
    if (blockNavigationOnUnsavedChanges()) {
      return;
    }

    setCurrentLocale(newLocale);
  };

  const cleanupUnusedImagesAfterSave = async (
    translations: Record<string, AboutTranslationData | HomeTranslationData>,
    isHome: boolean,
    userId: string
  ) => {
    try {
      const allSections = collectAllSections(translations, isHome);
      return await cleanupUnusedImages(allSections, userId);
    } catch (cleanupError) {
      console.error('Failed to cleanup unused images:', cleanupError);
      toast.warning(t('messages.cleanupFailed'));
      return 0;
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const user = await getCurrentUser();
      let cleanupCount = 0;

      if (activeTab === 'about' && aboutTranslations?.[currentLocale]) {
        if (aboutStructureVersion === null) {
          throw new Error('Missing about structure version');
        }

        const result =
          currentLocale === 'en-US'
            ? await ContentPageService.updateAboutPageStructure(
                aboutTranslations[currentLocale],
                aboutStructureVersion
              )
            : await ContentPageService.updateAboutPageLocale(
                currentLocale,
                aboutTranslations[currentLocale],
                aboutStructureVersion
              );
        setAboutTranslations(result.translations);
        setOriginalAboutTranslations(result.translations);
        setAboutStructureVersion(result.structureVersion);
        const content = createPageContentFromAboutTranslation(
          result.translations[currentLocale] || ({} as AboutTranslationData)
        );
        if (content) {
          resetRenderedEditor();
          setRenderedEditorPageContent(content);
        }

        if (user?.id) {
          cleanupCount = await cleanupUnusedImagesAfterSave(
            result.translations,
            false,
            user.id
          );
        }
      } else if (activeTab === 'home' && homeTranslations?.[currentLocale]) {
        if (homeStructureVersion === null) {
          throw new Error('Missing home structure version');
        }

        const result =
          currentLocale === 'en-US'
            ? await ContentPageService.updateHomePageStructure(
                homeTranslations[currentLocale],
                homeStructureVersion
              )
            : await ContentPageService.updateHomePageLocale(
                currentLocale,
                homeTranslations[currentLocale],
                homeStructureVersion
              );
        setHomeTranslations(result.translations);
        setOriginalHomeTranslations(result.translations);
        setHomeStructureVersion(result.structureVersion);
        const content = createPageContentFromHomeTranslation(
          result.translations[currentLocale] || ({} as HomeTranslationData)
        );
        if (content) {
          resetRenderedEditor();
          setRenderedEditorPageContent(content);
        }

        if (user?.id) {
          cleanupCount = await cleanupUnusedImagesAfterSave(
            result.translations,
            true,
            user.id
          );
        }
      } else {
        throw new Error('Missing current locale content');
      }

      clearPageContentCache(activeTab);

      if (cleanupCount > 0) {
        toast.success(
          `${t('messages.saveSuccess')} ${t('messages.cleanupImages', { count: cleanupCount })}`
        );
      } else {
        toast.success(t('messages.saveSuccess'));
      }
    } catch (error) {
      console.error('Save configuration failed:', error);
      const uiError = toUiError(error, t('messages.saveFailed'));
      if (uiError.code === 'ADMIN_CONTENT_STRUCTURE_CONFLICT') {
        setIsStructureConflictOpen(true);
      } else {
        toast.error(formatUiErrorMessage(uiError));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const executeTranslateAllLanguages = async () => {
    setIsTranslating(true);
    try {
      setIsTranslateConfirmOpen(false);
      if (activeTab === 'about' && aboutTranslations?.[currentLocale]) {
        if (aboutStructureVersion === null) {
          throw new Error('Missing about structure version');
        }

        const result =
          await ContentPageService.translateAllPageTranslations<AboutTranslationData>(
            {
              section: 'pages.about',
              sourceLocale: currentLocale,
              sourceData: aboutTranslations[currentLocale],
              basedOnStructureVersion: aboutStructureVersion,
              mode: 'overwrite',
            }
          );

        setAboutTranslations(result.translations);
        setOriginalAboutTranslations(result.translations);
        setAboutStructureVersion(result.structureVersion);
        const content = createPageContentFromAboutTranslation(
          result.translations[currentLocale] || ({} as AboutTranslationData)
        );
        if (content) {
          resetRenderedEditor();
          setRenderedEditorPageContent(content);
        }
        const failedLocales = result.results
          .filter(item => item.status === 'failed')
          .map(item => item.locale);
        if (failedLocales.length === 0 && result.success) {
          toast.success(t('messages.translateAllSuccess'));
        } else if (failedLocales.length < result.results.length) {
          toast.warning(
            `${t('messages.translateAllPartial', {
              successCount: result.results.length - failedLocales.length,
              failedCount: failedLocales.length,
            })}: ${failedLocales.join(', ')}`
          );
        } else {
          toast.error(
            `${t('messages.translateAllFailed')}: ${failedLocales.join(', ')}`
          );
        }
      } else if (activeTab === 'home' && homeTranslations?.[currentLocale]) {
        if (homeStructureVersion === null) {
          throw new Error('Missing home structure version');
        }

        const result =
          await ContentPageService.translateAllPageTranslations<HomeTranslationData>(
            {
              section: 'pages.home',
              sourceLocale: currentLocale,
              sourceData: homeTranslations[currentLocale],
              basedOnStructureVersion: homeStructureVersion,
              mode: 'overwrite',
            }
          );

        setHomeTranslations(result.translations);
        setOriginalHomeTranslations(result.translations);
        setHomeStructureVersion(result.structureVersion);
        const content = createPageContentFromHomeTranslation(
          result.translations[currentLocale] || ({} as HomeTranslationData)
        );
        if (content) {
          resetRenderedEditor();
          setRenderedEditorPageContent(content);
        }
        const failedLocales = result.results
          .filter(item => item.status === 'failed')
          .map(item => item.locale);
        if (failedLocales.length === 0 && result.success) {
          toast.success(t('messages.translateAllSuccess'));
        } else if (failedLocales.length < result.results.length) {
          toast.warning(
            `${t('messages.translateAllPartial', {
              successCount: result.results.length - failedLocales.length,
              failedCount: failedLocales.length,
            })}: ${failedLocales.join(', ')}`
          );
        } else {
          toast.error(
            `${t('messages.translateAllFailed')}: ${failedLocales.join(', ')}`
          );
        }
      } else {
        throw new Error('Missing source translation data');
      }

      clearPageContentCache(activeTab);
    } catch (error) {
      console.error('Translate all languages failed:', error);
      const uiError = toUiError(error, t('messages.translateAllFailed'));
      if (uiError.code === 'ADMIN_CONTENT_STRUCTURE_CONFLICT') {
        setIsStructureConflictOpen(true);
      } else {
        toast.error(formatUiErrorMessage(uiError));
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslateAllLanguages = () => {
    if (hasCurrentLocaleChanges) {
      toast.warning(t('messages.translateAllRequiresSavedChanges'));
      return;
    }

    setIsTranslateConfirmOpen(true);
  };

  const handleReset = () => {
    if (activeTab === 'about' && originalAboutTranslations) {
      setAboutTranslations(current =>
        current
          ? {
              ...current,
              [currentLocale]:
                originalAboutTranslations[currentLocale] ||
                ({} as AboutTranslationData),
            }
          : current
      );
      const content = createPageContentFromAboutTranslation(
        originalAboutTranslations[currentLocale] || ({} as AboutTranslationData)
      );

      if (content) {
        resetRenderedEditor();
        setRenderedEditorPageContent(content);
      }
      return;
    }

    if (activeTab === 'home' && originalHomeTranslations) {
      setHomeTranslations(current =>
        current
          ? {
              ...current,
              [currentLocale]:
                originalHomeTranslations[currentLocale] ||
                ({} as HomeTranslationData),
            }
          : current
      );
      const content = createPageContentFromHomeTranslation(
        originalHomeTranslations[currentLocale] || ({} as HomeTranslationData)
      );

      if (content) {
        resetRenderedEditor();
        setRenderedEditorPageContent(content);
      }
    }
  };

  const handleFullscreenPreview = () => {
    setShowFullscreenPreview(true);
  };

  const homePreviewConfig = transformToHomePreviewConfig(
    homeTranslations,
    currentLocale
  );
  const translateConfirmMessage = t('saveActions.translateAllConfirmMessage', {
    locale: `${getLanguageInfo(currentLocale).nativeName} (${currentLocale})`,
  });
  const translateDisabledReason = hasCurrentLocaleChanges
    ? t('messages.translateAllRequiresSavedChanges')
    : undefined;
  const convertedHomeTranslations =
    convertHomeTranslationsToAboutTranslations(homeTranslations);
  const fullscreenTitle =
    activeTab === 'about'
      ? aboutTranslations?.[currentLocale]?.title || 'About'
      : homePreviewConfig?.title || 'Home';

  const renderEditor = () => {
    if (isLoading) {
      return <EditorSkeleton />;
    }

    if (activeTab === 'about') {
      return aboutTranslations ? (
        <AboutEditor
          translations={aboutTranslations}
          currentLocale={currentLocale}
          supportedLocales={supportedLocales}
          onTranslationsChange={setAboutTranslations}
          onLocaleChange={handleLocaleChange}
        />
      ) : (
        <div>{t('loadingEditor.about')}</div>
      );
    }

    if (activeTab === 'home') {
      return convertedHomeTranslations ? (
        <AboutEditor
          translations={convertedHomeTranslations}
          currentLocale={currentLocale}
          supportedLocales={supportedLocales}
          onTranslationsChange={newTranslations => {
            setHomeTranslations(
              convertAboutTranslationsToHomeTranslations(newTranslations)
            );
          }}
          onLocaleChange={handleLocaleChange}
        />
      ) : (
        <div>{t('loadingEditor.home')}</div>
      );
    }

    return null;
  };

  const renderPreview = () => {
    if (activeTab === 'about') {
      const currentTranslation = aboutTranslations?.[currentLocale];
      return currentTranslation ? (
        <AboutPreview
          translation={currentTranslation}
          previewDevice={previewDevice}
        />
      ) : (
        <div>{t('loadingPreview')}</div>
      );
    }

    if (activeTab === 'home') {
      const currentHomeTranslation = homeTranslations?.[currentLocale];
      return currentHomeTranslation ? (
        <HomePreviewDynamic
          translation={currentHomeTranslation}
          previewDevice={previewDevice}
        />
      ) : (
        <div>{t('loadingPreview')}</div>
      );
    }

    return null;
  };

  const editorPane = (
    <div className={cn('flex h-full flex-col', 'bg-white dark:bg-stone-900')}>
      <div className="flex-1 overflow-auto px-6">{renderEditor()}</div>
      <ContentSaveActions
        hasChanges={hasCurrentLocaleChanges}
        isSaving={isSaving}
        isTranslating={isTranslating}
        isTranslateDisabled={Boolean(translateDisabledReason)}
        translateDisabledReason={translateDisabledReason}
        onReset={handleReset}
        onSave={handleSave}
        onTranslateAll={handleTranslateAllLanguages}
      />
    </div>
  );

  return (
    <div
      className={cn(
        'flex h-[calc(100vh-3rem)] flex-col overflow-hidden',
        'bg-stone-100 dark:bg-stone-950'
      )}
    >
      <ContentManagementHeader
        activeTab={activeTab}
        showPreview={showPreview}
        onShowPreview={() => setShowPreview(true)}
        onTabChange={handleTabChange}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {showPreview ? (
          <ResizableSplitPane
            storageKey="content-management-split-pane"
            defaultLeftWidth={50}
            minLeftWidth={30}
            maxLeftWidth={70}
            left={editorPane}
            right={
              <div className="flex h-full min-w-0 flex-col">
                <PreviewToolbar
                  activeTab={activeTab}
                  previewDevice={previewDevice}
                  onDeviceChange={setPreviewDevice}
                  showPreview={showPreview}
                  onPreviewToggle={() => setShowPreview(!showPreview)}
                  onFullscreenPreview={handleFullscreenPreview}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  {renderPreview()}
                </div>
              </div>
            }
          />
        ) : (
          editorPane
        )}
      </div>

      <ContentFullscreenPreview
        activeTab={activeTab}
        isOpen={showFullscreenPreview}
        title={fullscreenTitle}
        onClose={() => setShowFullscreenPreview(false)}
      >
        {renderPreview()}
      </ContentFullscreenPreview>

      <ConfirmDialog
        isOpen={isTranslateConfirmOpen}
        onClose={() => setIsTranslateConfirmOpen(false)}
        onConfirm={executeTranslateAllLanguages}
        title={t('saveActions.translateAllConfirmTitle')}
        message={translateConfirmMessage}
        confirmText={t('saveActions.confirmTranslateAll')}
      />

      <ConfirmDialog
        isOpen={isStructureConflictOpen}
        onClose={() => setIsStructureConflictOpen(false)}
        onConfirm={() => {
          window.location.reload();
        }}
        title={t('messages.structureConflictTitle')}
        message={t('messages.structureConflictMessage')}
        confirmText={t('messages.structureConflictReload')}
      />
    </div>
  );
}
