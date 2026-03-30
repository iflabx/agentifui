'use client';

import { AboutEditor } from '@components/admin/content/about-editor';
import { AboutPreview } from '@components/admin/content/about-preview';
import { EditorSkeleton } from '@components/admin/content/editor-skeleton';
import { HomePreviewDynamic } from '@components/admin/content/home-preview-dynamic';
import { PreviewToolbar } from '@components/admin/content/preview-toolbar';
import { ResizableSplitPane } from '@components/ui/resizable-split-pane';
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import type { SupportedLocale } from '@lib/config/language-config';
import { getCurrentLocaleFromCookie } from '@lib/config/language-config';
import { clearTranslationCache } from '@lib/hooks/use-dynamic-translations';
import { TranslationService } from '@lib/services/admin/content/translation-service';
import { cleanupUnusedImages } from '@lib/services/content-image-upload-service';
import { useAboutEditorStore } from '@lib/stores/about-editor-store';
import { useHomeEditorStore } from '@lib/stores/home-editor-store';
import type { AboutTranslationData } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import type { HomeTranslationData } from '@lib/utils/data-migration';
import { toast } from 'sonner';

import React, { useEffect, useState } from 'react';

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

  const { setPageContent: setAboutPageContent, reset: resetAboutEditor } =
    useAboutEditorStore();
  const { setPageContent: setHomePageContent, reset: resetHomeEditor } =
    useHomeEditorStore();

  const [activeTab, setActiveTab] = useState<'about' | 'home'>('about');
  const [showPreview, setShowPreview] = useState(true);
  const [previewDevice, setPreviewDevice] = useState<
    'desktop' | 'tablet' | 'mobile'
  >('desktop');
  const [isSaving, setIsSaving] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);

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
          const translations =
            await TranslationService.getAboutPageTranslations();
          setAboutTranslations(translations);
          setOriginalAboutTranslations(translations);
        } else {
          const translations =
            await TranslationService.getHomePageTranslations();
          setHomeTranslations(translations);
          setOriginalHomeTranslations(translations);
        }

        if (supportedLocales.length === 0) {
          const locales = await TranslationService.getSupportedLanguages();
          setSupportedLocales(locales);
        }
      } catch (error) {
        console.error(`Failed to load ${activeTab} translations:`, error);
        toast.error(t('messages.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    loadTranslations();
  }, [activeTab, supportedLocales.length, t]);

  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (tab === 'about' || tab === 'home') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    const aboutChanged =
      JSON.stringify(aboutTranslations) !==
      JSON.stringify(originalAboutTranslations);
    const homeChanged =
      JSON.stringify(homeTranslations) !==
      JSON.stringify(originalHomeTranslations);
    setHasChanges(aboutChanged || homeChanged);
  }, [
    aboutTranslations,
    originalAboutTranslations,
    homeTranslations,
    originalHomeTranslations,
  ]);

  const handleTabChange = (tab: 'about' | 'home') => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', tab);
    router.push(`?${params.toString()}`, { scroll: false });
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

      if (activeTab === 'about' && aboutTranslations) {
        await TranslationService.updateAboutPageTranslations(aboutTranslations);
        setOriginalAboutTranslations({ ...aboutTranslations });

        if (user?.id) {
          cleanupCount = await cleanupUnusedImagesAfterSave(
            aboutTranslations,
            false,
            user.id
          );
        }
      } else if (activeTab === 'home' && homeTranslations) {
        await TranslationService.updateHomePageTranslations(homeTranslations);
        setOriginalHomeTranslations({ ...homeTranslations });

        if (user?.id) {
          cleanupCount = await cleanupUnusedImagesAfterSave(
            homeTranslations,
            true,
            user.id
          );
        }
      }

      clearTranslationCache();

      if (cleanupCount > 0) {
        toast.success(
          `${t('messages.saveSuccess')} ${t('messages.cleanupImages', { count: cleanupCount })}`
        );
      } else {
        toast.success(t('messages.saveSuccess'));
      }
    } catch (error) {
      console.error('Save configuration failed:', error);
      toast.error(t('messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTranslateAllLanguages = async () => {
    setIsTranslating(true);
    try {
      if (activeTab === 'about' && aboutTranslations?.[currentLocale]) {
        const result =
          await TranslationService.translateAllPageTranslations<AboutTranslationData>(
            {
              section: 'pages.about',
              sourceLocale: currentLocale,
              sourceData: aboutTranslations[currentLocale],
            }
          );

        setAboutTranslations(result.translations);
        setOriginalAboutTranslations(result.translations);
      } else if (activeTab === 'home' && homeTranslations?.[currentLocale]) {
        const result =
          await TranslationService.translateAllPageTranslations<HomeTranslationData>(
            {
              section: 'pages.home',
              sourceLocale: currentLocale,
              sourceData: homeTranslations[currentLocale],
            }
          );

        setHomeTranslations(result.translations);
        setOriginalHomeTranslations(result.translations);
      } else {
        throw new Error('Missing source translation data');
      }

      clearTranslationCache();
      toast.success(t('messages.translateAllSuccess'));
    } catch (error) {
      console.error('Translate all languages failed:', error);
      toast.error(t('messages.translateAllFailed'));
    } finally {
      setIsTranslating(false);
    }
  };

  const handleReset = () => {
    if (activeTab === 'about' && originalAboutTranslations) {
      setAboutTranslations({ ...originalAboutTranslations });
      const content = createPageContentFromAboutTranslation(
        originalAboutTranslations[currentLocale] || ({} as AboutTranslationData)
      );

      if (content) {
        resetAboutEditor();
        setAboutPageContent(content);
      }
      return;
    }

    if (activeTab === 'home' && originalHomeTranslations) {
      setHomeTranslations({ ...originalHomeTranslations });
      const content = createPageContentFromHomeTranslation(
        originalHomeTranslations[currentLocale] || ({} as HomeTranslationData)
      );

      if (content) {
        resetHomeEditor();
        setHomePageContent(content);
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
          onLocaleChange={setCurrentLocale}
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
          onLocaleChange={setCurrentLocale}
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
        hasChanges={hasChanges}
        isSaving={isSaving}
        isTranslating={isTranslating}
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
    </div>
  );
}
