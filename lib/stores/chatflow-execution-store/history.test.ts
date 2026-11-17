import {
  buildChatflowExecutionMetadata,
  readChatflowExecutionMetadata,
} from './history';

describe('chatflow execution history metadata', () => {
  it('stores only display data and restores a completed execution', () => {
    const metadata = buildChatflowExecutionMetadata({
      isExecuting: false,
      error: null,
      nodes: [
        {
          id: 'node-1',
          title: 'Answer',
          status: 'completed',
          startTime: 1,
          endTime: 2,
          type: 'llm',
          description: 'Execution completed',
          iterations: [
            {
              id: 'iteration-1',
              index: 0,
              status: 'completed',
              startTime: 1,
              inputs: { secret: 'not persisted' },
              outputs: { answer: 'not persisted' },
            },
          ],
        },
      ],
    });

    const restored = readChatflowExecutionMetadata(metadata);

    expect(restored?.status).toBe('completed');
    expect(restored?.nodes[0]).toMatchObject({
      id: 'node-1',
      title: 'Answer',
      status: 'completed',
    });
    expect(restored?.nodes[0]?.iterations?.[0]).not.toHaveProperty('inputs');
    expect(restored?.nodes[0]?.iterations?.[0]).not.toHaveProperty('outputs');
  });

  it('rejects malformed metadata', () => {
    expect(
      readChatflowExecutionMetadata({
        chatflow_execution: { version: 1, status: 'completed', nodes: [] },
      })
    ).toBeNull();
  });
});
