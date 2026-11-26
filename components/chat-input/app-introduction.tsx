'use client';

export function AppIntroduction({
  name,
  description,
}: {
  name?: string | null;
  description?: string | null;
}) {
  if (!name?.trim() && !description?.trim()) return null;
  return (
    <header data-app-introduction className="mb-4 space-y-1 px-4">
      {name?.trim() && (
        <p
          data-chatflow-name
          data-app-name
          className="text-base font-semibold break-words text-stone-800 dark:text-stone-200"
        >
          {name.trim()}
        </p>
      )}
      {description?.trim() && (
        <div
          data-chatflow-description
          data-app-description
          className="markdown-body main-content-area assistant-message-content w-full text-base text-stone-500 dark:text-stone-400"
        >
          <p className="break-words whitespace-pre-wrap">{description}</p>
        </div>
      )}
    </header>
  );
}
