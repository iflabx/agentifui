import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

export type PageName = 'home' | 'about';

type ContentComponentType =
  | 'heading'
  | 'paragraph'
  | 'cards'
  | 'button'
  | 'image'
  | 'divider';

type JsonObject = Record<string, unknown>;

export interface ContentPageMetadata extends JsonObject {
  version?: string;
  lastModified?: string;
  author?: string;
  locale?: string;
  sourceLocale?: string;
  structureVersion?: number;
  basedOnStructureVersion?: number;
}

interface ContentComponent {
  id: string;
  type: ContentComponentType;
  props: JsonObject;
  inheritFromSection?: boolean;
  overrideProps?: string[];
}

interface ContentSection {
  id: string;
  layout: 'single-column' | 'two-column' | 'three-column';
  columns: ContentComponent[][];
  commonProps?: JsonObject;
}

interface ContentStructureFile {
  page: PageName;
  sourceLocale: string;
  metadata?: ContentPageMetadata;
  sections: ContentSection[];
}

interface ContentLocaleSection {
  id: string;
  columns: Array<
    Array<{ id: string; type: ContentComponentType; props: JsonObject }>
  >;
}

interface ContentLocaleFile {
  page: PageName;
  locale: string;
  metadata?: ContentPageMetadata;
  sections: ContentLocaleSection[];
}

export interface MergedPageContent {
  sections: ContentSection[];
  metadata?: ContentPageMetadata;
}

export class ContentPageStructureConflictError extends Error {
  code = 'CONTENT_PAGE_STRUCTURE_CONFLICT';
  currentStructureVersion: number;
  expectedStructureVersion: number;

  constructor(params: {
    currentStructureVersion: number;
    expectedStructureVersion: number;
  }) {
    super(
      `Expected structure version ${params.expectedStructureVersion}, current version is ${params.currentStructureVersion}`
    );
    this.name = 'ContentPageStructureConflictError';
    this.currentStructureVersion = params.currentStructureVersion;
    this.expectedStructureVersion = params.expectedStructureVersion;
  }
}

const SUPPORTED_LOCALES = new Set([
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'es-ES',
  'pt-PT',
  'fr-FR',
  'de-DE',
  'ru-RU',
  'it-IT',
]);

const SUPPORTED_PAGES = new Set<PageName>(['home', 'about']);
const DEFAULT_SOURCE_LOCALE = 'en-US';
const LOCK_TIMEOUT = 5000;
const fileLocks = new Map<string, { timestamp: number; processId: string }>();

function getContentPagesDirCandidates(): string[] {
  return [
    path.resolve(process.cwd(), 'content/pages'),
    path.resolve(process.cwd(), '..', 'content/pages'),
    path.resolve(process.cwd(), '..', '..', 'content/pages'),
  ];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {};
}

function withArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getStringProp(value: unknown, key: string): string {
  return isPlainObject(value) && typeof value[key] === 'string'
    ? (value[key] as string)
    : '';
}

function getNumberProp(value: unknown, key: string): number | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const candidate = value[key];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === 'string') {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function getSupportedLocales(): string[] {
  return Array.from(SUPPORTED_LOCALES);
}

export function isValidLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.has(locale);
}

export function isValidPageName(page: string): page is PageName {
  return SUPPORTED_PAGES.has(page as PageName);
}

function resolveContentPagesDirPath(): string {
  const candidates = getContentPagesDirCandidates();

  for (const directoryPath of candidates) {
    if (existsSync(directoryPath)) {
      return directoryPath;
    }
  }

  return candidates[0];
}

function resolveStructureFilePath(page: PageName): string {
  return path.join(resolveContentPagesDirPath(), page, 'structure.json');
}

function resolveLocaleFilePath(page: PageName, locale: string): string {
  return path.join(
    resolveContentPagesDirPath(),
    page,
    'locales',
    `${locale}.json`
  );
}

async function acquireLock(filePath: string): Promise<void> {
  const lockKey = path.basename(filePath);
  const now = Date.now();
  const processId = `${process.pid}-${now}`;

  const existingLock = fileLocks.get(lockKey);
  if (existingLock) {
    if (now - existingLock.timestamp < LOCK_TIMEOUT) {
      throw new Error(`File ${lockKey} is locked by another process`);
    }
    fileLocks.delete(lockKey);
  }

  fileLocks.set(lockKey, { timestamp: now, processId });
}

function releaseLock(filePath: string): void {
  fileLocks.delete(path.basename(filePath));
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown
): Promise<void> {
  const tempPath = `${filePath}.tmp`;

  try {
    await acquireLock(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // best effort cleanup
    }
    throw error;
  } finally {
    releaseLock(filePath);
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

export async function readStructureFile(
  page: PageName
): Promise<ContentStructureFile> {
  return readJsonFile<ContentStructureFile>(resolveStructureFilePath(page));
}

export async function readLocaleFile(
  page: PageName,
  locale: string
): Promise<ContentLocaleFile | null> {
  const filePath = resolveLocaleFilePath(page, locale);

  try {
    return await readJsonFile<ContentLocaleFile>(filePath);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeStructureFile(
  page: PageName,
  structureFile: ContentStructureFile
): Promise<void> {
  await writeJsonAtomic(resolveStructureFilePath(page), structureFile);
}

async function writeLocaleFile(
  page: PageName,
  locale: string,
  localeFile: ContentLocaleFile
): Promise<void> {
  await writeJsonAtomic(resolveLocaleFilePath(page, locale), localeFile);
}

function getStructureVersion(structureFile: ContentStructureFile): number {
  const candidate = getNumberProp(structureFile.metadata, 'structureVersion');
  return candidate && candidate > 0 ? Math.floor(candidate) : 1;
}

function assertStructureVersion(params: {
  currentStructureVersion: number;
  expectedStructureVersion?: number;
}) {
  const { currentStructureVersion, expectedStructureVersion } = params;
  if (
    typeof expectedStructureVersion === 'number' &&
    expectedStructureVersion !== currentStructureVersion
  ) {
    throw new ContentPageStructureConflictError({
      currentStructureVersion,
      expectedStructureVersion,
    });
  }
}

function normalizeCardItems(items: unknown, componentId: string): JsonObject[] {
  return withArray<JsonObject>(items).map((item, index) => ({
    ...(isPlainObject(item) ? item : {}),
    id:
      (isPlainObject(item) && typeof item.id === 'string' && item.id) ||
      `${componentId}-item-${index + 1}`,
  }));
}

function extractStructureProps(component: ContentComponent): JsonObject {
  const props = withObject(component.props);

  switch (component.type) {
    case 'heading':
      return {
        level: props.level ?? 2,
        textAlign: props.textAlign ?? 'left',
      };
    case 'paragraph':
      return {
        textAlign: props.textAlign ?? 'left',
      };
    case 'cards':
      return {
        layout: props.layout ?? 'grid',
        items: normalizeCardItems(props.items, component.id).map(item => {
          const nextItem: JsonObject = { id: item.id };
          if (typeof item.icon === 'string' && item.icon) {
            nextItem.icon = item.icon;
          }
          return nextItem;
        }),
      };
    case 'button': {
      const nextProps: JsonObject = {
        variant: props.variant ?? 'solid',
        action: props.action ?? 'link',
        url: props.url ?? '#',
        textAlign: props.textAlign ?? 'center',
      };

      if (isPlainObject(props.secondaryButton)) {
        nextProps.secondaryButton = {
          variant: props.secondaryButton.variant ?? 'outline',
          action: props.secondaryButton.action ?? 'link',
          url: props.secondaryButton.url ?? '#',
        };
      }

      return nextProps;
    }
    case 'image':
      return {
        src: props.src ?? '',
        alignment: props.alignment ?? 'center',
        width: props.width ?? 'auto',
        height: props.height ?? 'auto',
      };
    case 'divider':
      return {
        style: props.style ?? 'solid',
        color: props.color ?? 'gray',
        thickness: props.thickness ?? 'medium',
      };
    default:
      return {};
  }
}

function extractLocaleProps(
  targetComponent: ContentComponent,
  mergedComponent: ContentComponent | undefined
): JsonObject {
  const props = withObject(mergedComponent?.props);

  switch (targetComponent.type) {
    case 'heading':
    case 'paragraph':
      return {
        content: typeof props.content === 'string' ? props.content : '',
      };
    case 'cards': {
      const items = withArray<JsonObject>(props.items);
      const itemById = new Map(
        items
          .filter(item => typeof item.id === 'string')
          .map(item => [item.id as string, item])
      );

      return {
        items: normalizeCardItems(
          targetComponent.props.items,
          targetComponent.id
        ).map((item, index) => {
          const directMatch = itemById.get(item.id as string);
          const positionMatch = isPlainObject(items[index])
            ? items[index]
            : undefined;
          const resolved = directMatch || positionMatch;
          return {
            id: item.id,
            title:
              isPlainObject(resolved) && typeof resolved.title === 'string'
                ? resolved.title
                : '',
            description:
              isPlainObject(resolved) &&
              typeof resolved.description === 'string'
                ? resolved.description
                : '',
          };
        }),
      };
    }
    case 'button': {
      const nextProps: JsonObject = {
        text: typeof props.text === 'string' ? props.text : '',
      };

      if (isPlainObject(targetComponent.props.secondaryButton)) {
        nextProps.secondaryButton = {
          text: isPlainObject(props.secondaryButton)
            ? typeof props.secondaryButton.text === 'string'
              ? props.secondaryButton.text
              : ''
            : '',
        };
      }

      return nextProps;
    }
    case 'image':
      return {
        alt: typeof props.alt === 'string' ? props.alt : '',
        caption: typeof props.caption === 'string' ? props.caption : '',
      };
    default:
      return {};
  }
}

function normalizeSectionStructure(section: ContentSection): ContentSection {
  return {
    id: section.id,
    layout: section.layout,
    columns: withArray<ContentComponent[]>(section.columns).map(column =>
      withArray<ContentComponent>(column).map(component => ({
        id: component.id,
        type: component.type,
        props: extractStructureProps(component),
        ...(component.inheritFromSection !== undefined
          ? { inheritFromSection: component.inheritFromSection }
          : {}),
        ...(Array.isArray(component.overrideProps)
          ? { overrideProps: [...component.overrideProps] }
          : {}),
      }))
    ),
    ...(isPlainObject(section.commonProps)
      ? { commonProps: cloneJson(section.commonProps) }
      : {}),
  };
}

function buildMergedComponentLookup(
  pageContent: MergedPageContent
): Map<string, ContentComponent> {
  const lookup = new Map<string, ContentComponent>();

  pageContent.sections.forEach(section => {
    section.columns.forEach(column => {
      column.forEach(component => {
        lookup.set(component.id, component);
      });
    });
  });

  return lookup;
}

function normalizeMergedPageContent(value: unknown): MergedPageContent {
  const pageContent = withObject(value);
  const sections = withArray<ContentSection>(pageContent.sections).map(
    section => ({
      id: section.id,
      layout: section.layout,
      columns: withArray<ContentComponent[]>(section.columns).map(column =>
        withArray<ContentComponent>(column).map(component => ({
          id: component.id,
          type: component.type,
          props: cloneJson(withObject(component.props)),
          ...(component.inheritFromSection !== undefined
            ? { inheritFromSection: component.inheritFromSection }
            : {}),
          ...(Array.isArray(component.overrideProps)
            ? { overrideProps: [...component.overrideProps] }
            : {}),
        }))
      ),
      ...(isPlainObject(section.commonProps)
        ? { commonProps: cloneJson(section.commonProps) }
        : {}),
    })
  );

  return {
    sections,
    ...(isPlainObject(pageContent.metadata)
      ? { metadata: cloneJson(pageContent.metadata) }
      : {}),
  };
}

function createStructureFromMergedContent(
  page: PageName,
  mergedPageContent: MergedPageContent,
  sourceLocale: string,
  structureVersion: number
): ContentStructureFile {
  return {
    page,
    sourceLocale,
    metadata: {
      version: getStringProp(mergedPageContent.metadata, 'version') || '1.0.0',
      lastModified:
        getStringProp(mergedPageContent.metadata, 'lastModified') ||
        new Date().toISOString(),
      author:
        getStringProp(mergedPageContent.metadata, 'author') || 'admin-content',
      structureVersion,
    },
    sections: mergedPageContent.sections.map(normalizeSectionStructure),
  };
}

function createLocaleLayerFromMergedContent(params: {
  page: PageName;
  locale: string;
  mergedPageContent: MergedPageContent;
  structureFile: ContentStructureFile;
  basedOnStructureVersion: number;
}): ContentLocaleFile {
  const lookup = buildMergedComponentLookup(params.mergedPageContent);

  return {
    page: params.page,
    locale: params.locale,
    metadata: {
      version:
        getStringProp(params.mergedPageContent.metadata, 'version') || '1.0.0',
      lastModified:
        getStringProp(params.mergedPageContent.metadata, 'lastModified') ||
        new Date().toISOString(),
      author:
        getStringProp(params.mergedPageContent.metadata, 'author') ||
        'admin-content',
      locale: params.locale,
      basedOnStructureVersion: params.basedOnStructureVersion,
    },
    sections: params.structureFile.sections.map(section => ({
      id: section.id,
      columns: section.columns.map(column =>
        column.map(component => ({
          id: component.id,
          type: component.type,
          props: extractLocaleProps(component, lookup.get(component.id)),
        }))
      ),
    })),
  };
}

function buildLocaleComponentMap(
  localeFile: ContentLocaleFile | null | undefined
): Map<string, { id: string; type: ContentComponentType; props: JsonObject }> {
  const lookup = new Map<
    string,
    { id: string; type: ContentComponentType; props: JsonObject }
  >();

  localeFile?.sections?.forEach(section => {
    section.columns.forEach(column => {
      column.forEach(component => {
        lookup.set(component.id, component);
      });
    });
  });

  return lookup;
}

function resolveLocaleCardItemText(
  localeComponent: { props: JsonObject } | undefined,
  itemId: string,
  itemIndex: number
): { title: string; description: string } {
  const items = withArray<JsonObject>(localeComponent?.props?.items);
  const directMatch = items.find(item => item.id === itemId);
  const positionMatch = isPlainObject(items[itemIndex])
    ? items[itemIndex]
    : undefined;
  const resolved = directMatch || positionMatch;

  return {
    title:
      isPlainObject(resolved) && typeof resolved.title === 'string'
        ? resolved.title
        : '',
    description:
      isPlainObject(resolved) && typeof resolved.description === 'string'
        ? resolved.description
        : '',
  };
}

function mergeText(primary: string, fallback: string): string {
  return primary || fallback || '';
}

function mergeComponent(
  structureComponent: ContentComponent,
  localeComponent: { props: JsonObject } | undefined,
  fallbackComponent: { props: JsonObject } | undefined
): ContentComponent {
  const mergedProps = cloneJson(withObject(structureComponent.props));

  switch (structureComponent.type) {
    case 'heading':
    case 'paragraph':
      mergedProps.content = mergeText(
        getStringProp(localeComponent?.props, 'content'),
        getStringProp(fallbackComponent?.props, 'content')
      );
      break;
    case 'cards':
      mergedProps.items = normalizeCardItems(
        structureComponent.props.items,
        structureComponent.id
      ).map((item, index) => {
        const localeText = resolveLocaleCardItemText(
          localeComponent,
          item.id as string,
          index
        );
        const fallbackText = resolveLocaleCardItemText(
          fallbackComponent,
          item.id as string,
          index
        );

        return {
          ...item,
          title: mergeText(localeText.title, fallbackText.title),
          description: mergeText(
            localeText.description,
            fallbackText.description
          ),
        };
      });
      break;
    case 'button':
      mergedProps.text = mergeText(
        getStringProp(localeComponent?.props, 'text'),
        getStringProp(fallbackComponent?.props, 'text')
      );
      if (isPlainObject(structureComponent.props.secondaryButton)) {
        const structureSecondary = withObject(
          structureComponent.props.secondaryButton
        );
        const localeSecondary = withObject(
          localeComponent?.props.secondaryButton
        );
        const fallbackSecondary = withObject(
          fallbackComponent?.props.secondaryButton
        );
        mergedProps.secondaryButton = {
          ...cloneJson(structureSecondary),
          text: mergeText(
            getStringProp(localeSecondary, 'text'),
            getStringProp(fallbackSecondary, 'text')
          ),
        };
      }
      break;
    case 'image':
      mergedProps.alt = mergeText(
        getStringProp(localeComponent?.props, 'alt'),
        getStringProp(fallbackComponent?.props, 'alt')
      );
      mergedProps.caption = mergeText(
        getStringProp(localeComponent?.props, 'caption'),
        getStringProp(fallbackComponent?.props, 'caption')
      );
      break;
    default:
      break;
  }

  return {
    ...cloneJson(structureComponent),
    props: mergedProps,
  };
}

function mergePageContent(params: {
  structureFile: ContentStructureFile;
  localeFile: ContentLocaleFile | null;
  fallbackFile: ContentLocaleFile | null;
  locale: string;
}): MergedPageContent {
  const localeMap = buildLocaleComponentMap(params.localeFile);
  const fallbackMap = buildLocaleComponentMap(params.fallbackFile);

  return {
    sections: params.structureFile.sections.map(section => ({
      ...cloneJson(section),
      columns: section.columns.map(column =>
        column.map(component =>
          mergeComponent(
            component,
            localeMap.get(component.id),
            fallbackMap.get(component.id)
          )
        )
      ),
    })),
    metadata: {
      ...cloneJson(withObject(params.structureFile.metadata)),
      ...cloneJson(withObject(params.fallbackFile?.metadata)),
      ...cloneJson(withObject(params.localeFile?.metadata)),
      locale: params.locale,
      sourceLocale: params.structureFile.sourceLocale,
      structureVersion: getStructureVersion(params.structureFile),
      basedOnStructureVersion:
        getNumberProp(params.localeFile?.metadata, 'basedOnStructureVersion') ??
        getStructureVersion(params.structureFile),
    },
  };
}

export async function getMergedPageContent(
  page: PageName,
  locale: string
): Promise<MergedPageContent> {
  const structureFile = await readStructureFile(page);
  const fallbackLocale = structureFile.sourceLocale || DEFAULT_SOURCE_LOCALE;
  const fallbackFile = await readLocaleFile(page, fallbackLocale);
  const localeFile =
    locale === fallbackLocale
      ? fallbackFile
      : await readLocaleFile(page, locale);

  return mergePageContent({
    structureFile,
    localeFile,
    fallbackFile,
    locale,
  });
}

export async function getAllMergedPageTranslations(
  page: PageName
): Promise<Record<string, MergedPageContent>> {
  const translations: Record<string, MergedPageContent> = {};

  for (const locale of getSupportedLocales()) {
    translations[locale] = await getMergedPageContent(page, locale);
  }

  return translations;
}

export async function savePageStructure(params: {
  page: PageName;
  mergedPageContent: unknown;
  expectedStructureVersion?: number;
}): Promise<{
  sourceLocale: string;
  structureVersion: number;
  updatedAt: string;
  translations: Record<string, MergedPageContent>;
}> {
  const currentStructureFile = await readStructureFile(params.page);
  const currentStructureVersion = getStructureVersion(currentStructureFile);
  assertStructureVersion({
    currentStructureVersion,
    expectedStructureVersion: params.expectedStructureVersion,
  });

  const sourceLocale = DEFAULT_SOURCE_LOCALE;
  const nextStructureVersion = currentStructureVersion + 1;
  const sourceMergedContent = normalizeMergedPageContent(
    params.mergedPageContent
  );
  const structureFile = createStructureFromMergedContent(
    params.page,
    sourceMergedContent,
    sourceLocale,
    nextStructureVersion
  );

  await writeStructureFile(params.page, structureFile);
  const localeLayer = createLocaleLayerFromMergedContent({
    page: params.page,
    locale: sourceLocale,
    mergedPageContent: sourceMergedContent,
    structureFile,
    basedOnStructureVersion: nextStructureVersion,
  });
  await writeLocaleFile(params.page, sourceLocale, localeLayer);

  return {
    sourceLocale,
    structureVersion: nextStructureVersion,
    updatedAt: new Date().toISOString(),
    translations: await getAllMergedPageTranslations(params.page),
  };
}

export async function savePageLocale(params: {
  page: PageName;
  locale: string;
  mergedPageContent: unknown;
  basedOnStructureVersion: number;
}): Promise<{
  sourceLocale: string;
  structureVersion: number;
  updatedAt: string;
  translations: Record<string, MergedPageContent>;
}> {
  const structureFile = await readStructureFile(params.page);
  const sourceLocale = structureFile.sourceLocale || DEFAULT_SOURCE_LOCALE;
  const structureVersion = getStructureVersion(structureFile);
  assertStructureVersion({
    currentStructureVersion: structureVersion,
    expectedStructureVersion: params.basedOnStructureVersion,
  });

  const localeLayer = createLocaleLayerFromMergedContent({
    page: params.page,
    locale: params.locale,
    mergedPageContent: normalizeMergedPageContent(params.mergedPageContent),
    structureFile,
    basedOnStructureVersion: structureVersion,
  });
  await writeLocaleFile(params.page, params.locale, localeLayer);

  return {
    sourceLocale,
    structureVersion,
    updatedAt: new Date().toISOString(),
    translations: await getAllMergedPageTranslations(params.page),
  };
}

export async function saveTranslatedLocale(params: {
  page: PageName;
  locale: string;
  mergedPageContent: unknown;
  basedOnStructureVersion: number;
}): Promise<void> {
  const structureFile = await readStructureFile(params.page);
  const structureVersion = getStructureVersion(structureFile);
  assertStructureVersion({
    currentStructureVersion: structureVersion,
    expectedStructureVersion: params.basedOnStructureVersion,
  });

  const localeLayer = createLocaleLayerFromMergedContent({
    page: params.page,
    locale: params.locale,
    mergedPageContent: normalizeMergedPageContent(params.mergedPageContent),
    structureFile,
    basedOnStructureVersion: structureVersion,
  });
  await writeLocaleFile(params.page, params.locale, localeLayer);
}

export async function getPageStructureInfo(page: PageName): Promise<{
  sourceLocale: string;
  structureVersion: number;
}> {
  const structureFile = await readStructureFile(page);
  return {
    sourceLocale: structureFile.sourceLocale || DEFAULT_SOURCE_LOCALE,
    structureVersion: getStructureVersion(structureFile),
  };
}

export async function getSourceLocaleLayer(page: PageName): Promise<{
  sourceLocale: string;
  structureVersion: number;
  localeFile: ContentLocaleFile;
}> {
  const structureFile = await readStructureFile(page);
  const sourceLocale = structureFile.sourceLocale || DEFAULT_SOURCE_LOCALE;
  const localeFile = await readLocaleFile(page, sourceLocale);

  if (!localeFile) {
    throw new Error(`Missing source locale layer for ${page}/${sourceLocale}`);
  }

  return {
    sourceLocale,
    structureVersion: getStructureVersion(structureFile),
    localeFile,
  };
}
