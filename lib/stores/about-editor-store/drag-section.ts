import type { PageContent } from '@lib/types/about-page-components';

import type { AboutDragEndResult } from './types';

export function handleAboutSectionDrag(
  activeId: string,
  overId: string,
  pageContent: PageContent
): AboutDragEndResult | null {
  if (!activeId.startsWith('section-')) {
    return null;
  }

  const activeSectionId = activeId.replace('section-', '');
  const activeSectionIndex = pageContent.sections.findIndex(
    section => section.id === activeSectionId
  );
  if (activeSectionIndex === -1) {
    return { handled: false };
  }

  let targetIndex = -1;
  if (overId === 'section-drop-final') {
    targetIndex = pageContent.sections.length;
  } else if (overId.startsWith('section-drop-')) {
    targetIndex = Number(overId.replace('section-drop-', ''));
  }

  if (targetIndex < 0 || targetIndex > pageContent.sections.length) {
    return { handled: false };
  }

  let finalTargetIndex = targetIndex;
  if (activeSectionIndex < targetIndex) {
    finalTargetIndex = targetIndex - 1;
  }

  if (activeSectionIndex === finalTargetIndex) {
    return { handled: true };
  }

  const nextPageContent: PageContent = {
    ...pageContent,
    sections: [...pageContent.sections],
  };
  const [movedSection] = nextPageContent.sections.splice(activeSectionIndex, 1);
  nextPageContent.sections.splice(finalTargetIndex, 0, movedSection);

  return {
    handled: true,
    state: {
      pageContent: nextPageContent,
      isDirty: true,
    },
  };
}
