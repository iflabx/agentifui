/** @jest-environment node */
import { requiresDifyResourceAdmin } from './resource-access';

describe('application-scoped Dify resource boundary', () => {
  it.each([
    ['workflows/logs', undefined],
    ['workflows/run/run-id', undefined],
    ['workflows/tasks/task-id/stop', undefined],
    ['files/file-id/preview', undefined],
    ['logs', 'workflow'],
    ['run/run-id', 'workflow'],
    ['tasks/task-id/stop', 'workflow'],
  ])('restricts %s with app type %s', (path, appType) => {
    expect(requiresDifyResourceAdmin(path.split('/'), appType)).toBe(true);
  });

  it.each([
    ['chat-messages', undefined],
    ['chat-messages/task-id/stop', undefined],
    ['completion-messages/task-id/stop', 'text-generation'],
    ['workflows/run', 'workflow'],
    ['workflows/version-id/run', 'workflow'],
    ['run', 'workflow'],
    ['files/upload', 'workflow'],
    ['messages', undefined],
    ['conversations', undefined],
    ['parameters', 'workflow'],
  ])('preserves %s with app type %s', (path, appType) => {
    expect(requiresDifyResourceAdmin(path.split('/'), appType)).toBe(false);
  });
});
