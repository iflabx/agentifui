import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PAGE_NAMES = ['home', 'about'];
export const SOURCE_LOCALE = 'en-US';

export function resolveRootDir(rootDir = process.cwd()) {
  return rootDir;
}

export function resolveMessagesDir(rootDir = process.cwd()) {
  return path.resolve(resolveRootDir(rootDir), 'messages');
}

export function resolveContentPagesDir(rootDir = process.cwd()) {
  return path.resolve(resolveRootDir(rootDir), 'content/pages');
}

export function resolveLanguageConfigPath(rootDir = process.cwd()) {
  return path.resolve(resolveRootDir(rootDir), 'lib/config/language-config.ts');
}

export function parseSupportedLocales(rootDir = process.cwd()) {
  const source = readFileSync(resolveLanguageConfigPath(rootDir), 'utf8');
  const match = source.match(
    /export\s+const\s+SUPPORTED_LANGUAGES\s*=\s*{([\s\S]*?)}\s*as\s+const;/
  );

  if (!match) {
    throw new Error('Cannot parse SUPPORTED_LANGUAGES from language-config.ts');
  }

  return [...match[1].matchAll(/^\s*['"]([^'"]+)['"]\s*:\s*{/gm)].map(
    item => item[1]
  );
}

export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withObject(value) {
  return isPlainObject(value) ? value : {};
}

function withArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCardItems(items, componentId) {
  return withArray(items).map((item, index) => ({
    ...(isPlainObject(item) ? item : {}),
    id:
      (isPlainObject(item) && typeof item.id === 'string' && item.id) ||
      `${componentId}-item-${index + 1}`,
  }));
}

function extractStructureProps(component) {
  const props = withObject(component?.props);

  switch (component?.type) {
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
          const nextItem = { id: item.id };
          if (typeof item.icon === 'string' && item.icon) {
            nextItem.icon = item.icon;
          }
          return nextItem;
        }),
      };
    case 'button': {
      const nextProps = {
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

function extractLocaleProps(component, matchedComponent) {
  const matchedProps = withObject(matchedComponent?.props);

  switch (component?.type) {
    case 'heading':
    case 'paragraph':
      return {
        content:
          typeof matchedProps.content === 'string' ? matchedProps.content : '',
      };
    case 'cards': {
      const matchedItems = withArray(matchedProps.items);
      const matchedItemById = new Map(
        matchedItems
          .filter(isPlainObject)
          .map(item => [typeof item.id === 'string' ? item.id : null, item])
          .filter(item => item[0])
      );

      const targetItems = withArray(component?.props?.items);
      return {
        items: targetItems.map((item, index) => {
          const targetItem = withObject(item);
          const directMatch = matchedItemById.get(targetItem.id);
          const positionMatch = isPlainObject(matchedItems[index])
            ? matchedItems[index]
            : undefined;
          const resolved = directMatch || positionMatch;

          return {
            id: targetItem.id,
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
      const nextProps = {
        text: typeof matchedProps.text === 'string' ? matchedProps.text : '',
      };

      if (isPlainObject(component?.props?.secondaryButton)) {
        nextProps.secondaryButton = {
          text: isPlainObject(matchedProps.secondaryButton)
            ? typeof matchedProps.secondaryButton.text === 'string'
              ? matchedProps.secondaryButton.text
              : ''
            : '',
        };
      }

      return nextProps;
    }
    case 'image':
      return {
        alt: typeof matchedProps.alt === 'string' ? matchedProps.alt : '',
        caption:
          typeof matchedProps.caption === 'string' ? matchedProps.caption : '',
      };
    default:
      return {};
  }
}

function normalizeSectionStructure(section) {
  return {
    id: section.id,
    layout: section.layout,
    columns: withArray(section.columns).map(column =>
      withArray(column).map(component => ({
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

function flattenSectionComponents(section) {
  return withArray(section?.columns).flatMap(column => withArray(column));
}

function createTypeIndexedLookup(section) {
  const lookup = new Map();

  flattenSectionComponents(section).forEach((component, index) => {
    const type = component?.type;
    if (!lookup.has(type)) {
      lookup.set(type, []);
    }
    lookup.get(type).push({ component, index });
  });

  return lookup;
}

function createPageTypeIndexedLookup(sourcePageData) {
  const lookup = new Map();

  withArray(sourcePageData?.sections).forEach((section, sectionIndex) => {
    withArray(section?.columns).forEach((column, columnIndex) => {
      withArray(column).forEach((component, componentIndex) => {
        if (!lookup.has(component?.type)) {
          lookup.set(component?.type, []);
        }

        lookup.get(component.type).push({
          component,
          sectionIndex,
          columnIndex,
          componentIndex,
        });
      });
    });
  });

  return lookup;
}

function getBaselineComponent(params) {
  return withArray(
    params.baselinePageData?.sections?.[params.targetSectionIndex]?.columns?.[
      params.targetColumnIndex
    ]
  )[params.targetComponentIndex];
}

function getStringProp(value, key) {
  return isPlainObject(value) && typeof value[key] === 'string'
    ? value[key]
    : '';
}

function scoreGlobalCandidate(params) {
  const { candidate, baselineComponent, targetComponent, targetSectionIndex } =
    params;
  let score = 0;

  score -= Math.abs(candidate.sectionIndex - targetSectionIndex) * 10;

  const baselineProps = withObject(baselineComponent?.props);
  const candidateProps = withObject(candidate.component?.props);
  const baselineContent = getStringProp(baselineProps, 'content');
  const candidateContent = getStringProp(candidateProps, 'content');

  if (targetComponent.type === 'button') {
    if (candidateProps.url === targetComponent?.props?.url) {
      score += 40;
    }
    if (typeof candidateProps.text === 'string' && candidateProps.text.trim()) {
      score += 10;
    }
  }

  if (baselineContent.includes('{year}') || baselineContent.includes('©')) {
    if (
      candidateContent.includes('{year}') ||
      candidateContent.includes('©')
    ) {
      score += 80;
    } else {
      score -= 40;
    }
  }

  if (
    targetComponent.type === 'paragraph' &&
    baselineContent &&
    candidateContent &&
    baselineContent.length < 80 &&
    candidateContent.length < 80
  ) {
    score += 5;
  }

  return score;
}

function shouldPreferGlobalFallback(params) {
  const baselineComponent = getBaselineComponent(params);
  const baselineContent = getStringProp(baselineComponent?.props, 'content');

  if (params.targetComponent.type === 'button') {
    return true;
  }

  if (baselineContent.includes('{year}') || baselineContent.includes('©')) {
    return true;
  }

  return false;
}

function resolveMatchedComponent(params) {
  const {
    targetComponent,
    targetSectionIndex,
    targetColumnIndex,
    targetComponentIndex,
    sourcePageData,
    report,
  } = params;

  const sourceSections = withArray(sourcePageData?.sections);
  const sourceComponentById = params.sourceComponentById;
  const sourceSection = sourceSections[targetSectionIndex];

  const directById = sourceComponentById.get(targetComponent.id);
  if (directById && directById.type === targetComponent.type) {
    report.byId += 1;
    return directById;
  }

  const directByPosition = withArray(
    sourceSection?.columns?.[targetColumnIndex]
  )[targetComponentIndex];
  if (directByPosition && directByPosition.type === targetComponent.type) {
    report.byPosition += 1;
    return directByPosition;
  }

  const sectionLookup = createTypeIndexedLookup(sourceSection);
  const candidates = sectionLookup.get(targetComponent.type) || [];
  const usedIndexes =
    params.usedComponentIndexes.get(targetSectionIndex) || new Set();
  const preferGlobalFallback = shouldPreferGlobalFallback(params);

  if (!preferGlobalFallback) {
    const fallback = candidates.find(item => !usedIndexes.has(item.index));

    if (fallback) {
      usedIndexes.add(fallback.index);
      params.usedComponentIndexes.set(targetSectionIndex, usedIndexes);
      report.byTypeFallback += 1;
      return fallback.component;
    }
  }

  const globalCandidates =
    params.pageTypeLookup.get(targetComponent.type)?.filter(candidate => {
      const sectionUsedIndexes =
        params.usedGlobalComponentIndexes.get(candidate.sectionIndex) ||
        new Set();
      return !sectionUsedIndexes.has(
        `${candidate.columnIndex}:${candidate.componentIndex}`
      );
    }) || [];

  if (globalCandidates.length > 0) {
    const baselineComponent = getBaselineComponent(params);
    const bestCandidate = globalCandidates
      .map(candidate => ({
        candidate,
        score: scoreGlobalCandidate({
          candidate,
          baselineComponent,
          targetComponent,
          targetSectionIndex,
        }),
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidate;

    if (bestCandidate) {
      const sectionUsedIndexes =
        params.usedGlobalComponentIndexes.get(bestCandidate.sectionIndex) ||
        new Set();
      sectionUsedIndexes.add(
        `${bestCandidate.columnIndex}:${bestCandidate.componentIndex}`
      );
      params.usedGlobalComponentIndexes.set(
        bestCandidate.sectionIndex,
        sectionUsedIndexes
      );
      report.byTypeFallback += 1;
      return bestCandidate.component;
    }
  }

  if (preferGlobalFallback) {
    const fallback = candidates.find(item => !usedIndexes.has(item.index));

    if (fallback) {
      usedIndexes.add(fallback.index);
      params.usedComponentIndexes.set(targetSectionIndex, usedIndexes);
      report.byTypeFallback += 1;
      return fallback.component;
    }
  }

  report.missing += 1;
  return null;
}

export function createStructureFile(params) {
  const { pageName, pageData } = params;
  const sections = withArray(pageData?.sections).map(normalizeSectionStructure);

  return {
    page: pageName,
    sourceLocale: SOURCE_LOCALE,
    metadata: {
      version:
        typeof pageData?.metadata?.version === 'string'
          ? pageData.metadata.version
          : '1.0.0',
      lastModified:
        typeof pageData?.metadata?.lastModified === 'string'
          ? pageData.metadata.lastModified
          : new Date().toISOString(),
      author:
        typeof pageData?.metadata?.author === 'string'
          ? pageData.metadata.author
          : 'page-content-migration',
      structureVersion: 1,
    },
    sections,
  };
}

export function createLocaleLayer(params) {
  const {
    locale,
    pageName,
    sourcePageData,
    structureFile,
    report = {
      byId: 0,
      byPosition: 0,
      byTypeFallback: 0,
      missing: 0,
    },
  } = params;

  const sourceSections = withArray(sourcePageData?.sections);
  const sourceComponentById = new Map();
  const pageTypeLookup = createPageTypeIndexedLookup(sourcePageData);

  sourceSections.forEach(section => {
    flattenSectionComponents(section).forEach(component => {
      if (component?.id) {
        sourceComponentById.set(component.id, component);
      }
    });
  });

  const usedComponentIndexes = new Map();
  const usedGlobalComponentIndexes = new Map();

  const sections = structureFile.sections.map((targetSection, sectionIndex) => {
    const columns = targetSection.columns.map((targetColumn, columnIndex) =>
      targetColumn.map((targetComponent, componentIndex) => {
        const matchedComponent = resolveMatchedComponent({
          targetComponent,
          targetSectionIndex: sectionIndex,
          targetColumnIndex: columnIndex,
          targetComponentIndex: componentIndex,
          sourcePageData,
          sourceComponentById,
          usedComponentIndexes,
          usedGlobalComponentIndexes,
          pageTypeLookup,
          baselinePageData: params.baselinePageData,
          report,
        });

        return {
          id: targetComponent.id,
          type: targetComponent.type,
          props: extractLocaleProps(targetComponent, matchedComponent),
        };
      })
    );

    return {
      id: targetSection.id,
      columns,
    };
  });

  return {
    page: pageName,
    locale,
    metadata: {
      version:
        typeof sourcePageData?.metadata?.version === 'string'
          ? sourcePageData.metadata.version
          : '1.0.0',
      lastModified:
        typeof sourcePageData?.metadata?.lastModified === 'string'
          ? sourcePageData.metadata.lastModified
          : new Date().toISOString(),
      author:
        typeof sourcePageData?.metadata?.author === 'string'
          ? sourcePageData.metadata.author
          : 'page-content-migration',
      locale,
      basedOnStructureVersion: 1,
    },
    sections,
  };
}

export function readLocaleMessages(rootDir, locale) {
  const filePath = path.resolve(resolveMessagesDir(rootDir), `${locale}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Missing locale file: ${filePath}`);
  }

  return readJsonFile(filePath);
}

function collectComponentPaths(structureSections) {
  const paths = [];

  structureSections.forEach((section, sectionIndex) => {
    section.columns.forEach((column, columnIndex) => {
      column.forEach((component, componentIndex) => {
        paths.push(
          `sections[${sectionIndex}].columns[${columnIndex}][${componentIndex}]#${component.id}:${component.type}`
        );

        if (component.type === 'cards') {
          withArray(component.props?.items).forEach((item, itemIndex) => {
            paths.push(
              `sections[${sectionIndex}].columns[${columnIndex}][${componentIndex}].items[${itemIndex}]#${item.id}`
            );
          });
        }
      });
    });
  });

  return paths;
}

export function validateContentFiles(params) {
  const { structureFile, localeLayer } = params;
  const errors = [];

  if (
    !Array.isArray(structureFile.sections) ||
    structureFile.sections.length === 0
  ) {
    errors.push('structure sections are missing');
    return errors;
  }

  const structurePaths = collectComponentPaths(structureFile.sections);
  const localePaths = collectComponentPaths(localeLayer.sections || []);

  if (structurePaths.length !== localePaths.length) {
    errors.push(
      `shape mismatch: expected ${structurePaths.length} nodes, found ${localePaths.length}`
    );
  }

  structurePaths.forEach((structurePath, index) => {
    if (localePaths[index] !== structurePath) {
      errors.push(
        `shape mismatch at index ${index}: expected ${structurePath}, found ${localePaths[index] || '<missing>'}`
      );
    }
  });

  return errors;
}
