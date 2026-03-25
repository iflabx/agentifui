export type TextGenerationTargetApp = {
  id: string;
  instance_id: string;
};

export async function resolveTextGenerationTargetApp(
  instanceId: string,
  context: 'execution' | 'history' | 'stop'
): Promise<TextGenerationTargetApp | null> {
  const { useAppListStore } = await import('@lib/stores/app-list-store');
  const appListState = useAppListStore.getState();

  if (appListState.apps.length === 0) {
    if (context === 'history') {
      console.log(
        '[Text Generation] History load: app list empty, fetching app list'
      );
    } else {
      console.log('[Text Generation] App list empty, fetching app list');
    }
    await appListState.fetchApps();
  }

  return (
    useAppListStore
      .getState()
      .apps.find(app => app.instance_id === instanceId) ?? null
  );
}
