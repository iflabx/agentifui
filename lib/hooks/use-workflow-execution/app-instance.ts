export type WorkflowTargetApp = {
  id: string;
  instance_id: string;
};

export async function resolveWorkflowTargetApp(
  instanceId: string,
  context: 'execution' | 'history'
): Promise<WorkflowTargetApp | null> {
  const { useAppListStore } = await import('@lib/stores/app-list-store');
  const appListState = useAppListStore.getState();

  if (appListState.apps.length === 0) {
    if (context === 'execution') {
      console.log('[Workflow Execution] App list is empty, fetching app list');
    } else {
      console.log(
        '[Workflow Execution] History load: app list is empty, fetching app list'
      );
    }
    await appListState.fetchApps();
  }

  return (
    useAppListStore
      .getState()
      .apps.find(app => app.instance_id === instanceId) ?? null
  );
}
