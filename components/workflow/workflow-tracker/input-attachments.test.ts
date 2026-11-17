import { extractWorkflowInputAttachments } from './input-attachments';

describe('extractWorkflowInputAttachments', () => {
  it('restores uploaded files from persisted workflow inputs', () => {
    expect(
      extractWorkflowInputAttachments(
        {
          source: [
            {
              upload_file_id: 'file-1',
              name: 'report.pdf',
              size: 128,
              mime_type: 'application/pdf',
            },
          ],
        },
        'app-1'
      )
    ).toEqual([
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 128,
        type: 'application/pdf',
        upload_file_id: 'file-1',
        app_id: 'app-1',
      },
    ]);
  });

  it('deduplicates the same uploaded file in multiple input fields', () => {
    const result = extractWorkflowInputAttachments({
      first: { upload_file_id: 'file-1', name: 'a.txt' },
      second: { upload_file_id: 'file-1', name: 'a.txt' },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.upload_file_id).toBe('file-1');
  });
});
