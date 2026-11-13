import { adjustApiPathByAppType, isDifyFilePreviewPath } from './helpers';

export function requiresDifyResourceAdmin(
  slug: string[],
  appType?: string
): boolean {
  const path = adjustApiPathByAppType(slug, appType);
  return (
    path === 'workflows/logs' ||
    /^workflows\/run\/[^/]+$/.test(path) ||
    /^workflows\/tasks\/[^/]+\/stop$/.test(path) ||
    isDifyFilePreviewPath(path)
  );
}
