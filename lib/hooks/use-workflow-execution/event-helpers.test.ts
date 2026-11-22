import { buildNormalizedWorkflowInputs } from './event-helpers';

it('preserves original variable keys without inventing lowercase file aliases', () => {
  const files = [{ upload_file_id: 'synthetic-file' }];
  expect(
    buildNormalizedWorkflowInputs({
      ReferenceFiles: files,
      Prompt: 'task',
      absent: undefined,
    })
  ).toEqual({ ReferenceFiles: files, Prompt: 'task' });
});

it('keeps independently declared case-sensitive variables', () => {
  expect(
    buildNormalizedWorkflowInputs({ Name: 'upper', name: 'lower' })
  ).toEqual({ Name: 'upper', name: 'lower' });
});
