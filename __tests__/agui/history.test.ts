/** @jest-environment node */
import {
  AGUI_TOOL_SUMMARY,
  type Message,
  agentModelInputMessages,
  mergeAgentHistoryPage,
  mergeAgentHistoryResult,
  readAgentHistoryMessages,
  readAgentHistoryResult,
} from '../../packages/shared/src/agui';

const identity = { threadId: 'thread', runId: 'run' };
const question: Message = { id: 'question', role: 'user', content: 'question' };
const answer: Message = {
  id: 'answer',
  role: 'assistant',
  content: 'result copy',
};
const activity: Message = {
  id: 'activity',
  role: 'activity',
  activityType: AGUI_TOOL_SUMMARY,
  content: { name: 'lookup', status: 'completed', parentMessageId: 'answer' },
};
const resultV2 = {
  schemaVersion: 2,
  ...identity,
  status: 'succeeded',
  messages: [question, answer, activity],
  outputMessageIds: [answer.id, activity.id],
  warnings: [],
};

describe('AG-UI pure history compatibility', () => {
  it.each([undefined, 1])(
    'reads old version %s without inventing tool interleaving',
    schemaVersion => {
      const history = readAgentHistoryResult(
        {
          schemaVersion,
          executionStatus: 'success',
          messages: [
            {
              id: 'answer',
              content: 'legacy',
              tools: [
                {
                  toolCallId: 'private-native-id',
                  name: 'lookup',
                  status: 'completed',
                  arguments: 'private',
                },
              ],
            },
          ],
          nativeBinding: 'private',
        },
        identity
      );
      expect(history.sourceVersion).toBe(1);
      expect(history.projection).toMatchObject({
        status: 'succeeded',
        messages: [{ id: 'answer', role: 'assistant', content: 'legacy' }],
        warnings: ['legacy-tool-order-unavailable'],
      });
      expect(history.legacyTools).toEqual([
        { parentMessageId: 'answer', name: 'lookup', status: 'completed' },
      ]);
      expect(history.projection.outputMessageIds).toEqual(['answer']);
      expect(JSON.stringify(history)).not.toContain('private');
    }
  );

  it('reads an ordered v2 snapshot and strips private extras and diagnostic text', () => {
    const history = readAgentHistoryResult(
      {
        ...resultV2,
        nativeBinding: 'private',
        warnings: ['unrecognized-event', 'private diagnostic'],
        messages: resultV2.messages.map(message => ({
          ...message,
          metadata: { token: 'private' },
          debug: 'private',
        })),
      },
      identity
    );
    expect(history.sourceVersion).toBe(2);
    expect(history.projection.messages).toEqual(resultV2.messages);
    expect(history.projection.warnings).toEqual([
      'unrecognized-event',
      'unrecognized-history-warning',
    ]);
    expect(JSON.stringify(history)).not.toContain('private');
  });

  it.each(['failed', 'unknown', 'cancelled', 'interrupted'])(
    'retains the %s result independently of storage',
    status => {
      expect(
        readAgentHistoryResult({ ...resultV2, status }, identity).projection
          .status
      ).toBe(status);
    }
  );

  it('rejects an unknown version, wrong run, duplicate IDs and malformed legacy tools', () => {
    expect(() =>
      readAgentHistoryResult({ ...resultV2, schemaVersion: 3 }, identity)
    ).toThrow('AGENT_HISTORY_VERSION_UNSUPPORTED');
    expect(() =>
      readAgentHistoryResult({ ...resultV2, runId: 'other' }, identity)
    ).toThrow('AGENT_RUN_ID_MISMATCH');
    expect(() =>
      readAgentHistoryResult(
        { ...resultV2, messages: [answer, answer] },
        identity
      )
    ).toThrow('AGENT_MESSAGES_INVALID');
    expect(() =>
      readAgentHistoryResult(
        {
          executionStatus: 'success',
          messages: [{ id: 'answer', content: 'old', tools: {} }],
        },
        identity
      )
    ).toThrow('AGENT_HISTORY_INVALID');
  });

  it('keeps visible activities and reasoning out of model input without altering history', () => {
    const reasoning: Message = {
      id: 'reasoning',
      role: 'reasoning',
      content: 'visible explanation',
    };
    const history = [question, answer, activity, reasoning];
    expect(agentModelInputMessages(history)).toEqual([question, answer]);
    expect(readAgentHistoryMessages(history)).toEqual(history);
    expect(history).toHaveLength(4);
  });

  it('rejects unsupported model content instead of silently losing it', () => {
    expect(() =>
      readAgentHistoryMessages([
        {
          id: 'media',
          role: 'user',
          content: [{ type: 'text', text: 'structured' }],
        },
      ])
    ).toThrow('AGENT_HISTORY_UNSUPPORTED');
    expect(() =>
      readAgentHistoryMessages([
        {
          ...answer,
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            },
          ],
        },
      ])
    ).toThrow('AGENT_HISTORY_UNSUPPORTED');
    expect(() =>
      readAgentHistoryMessages([{ ...answer, encryptedValue: 'opaque' }])
    ).toThrow('AGENT_HISTORY_UNSUPPORTED');
  });

  it('uses an inert placeholder for unknown activities', () => {
    expect(
      readAgentHistoryMessages([
        {
          ...activity,
          activityType: 'future.v1',
          content: { html: 'private' },
        },
      ])
    ).toEqual([
      {
        id: 'activity',
        role: 'activity',
        activityType: 'future.v1',
        content: {},
      },
    ]);
  });

  it('merges overlapping pages without interpreting a page as a full snapshot', () => {
    const first = mergeAgentHistoryPage([question, answer], [answer, activity]);
    expect(first).toEqual([question, answer, activity]);
    const older: Message = { id: 'older', role: 'user', content: 'older' };
    const second = mergeAgentHistoryPage(first, [older, question], 'before');
    expect(second).toEqual([older, question, answer, activity]);
    expect(mergeAgentHistoryPage(second, [answer, activity])).toEqual(second);
    expect(() =>
      mergeAgentHistoryPage(second, [
        { id: answer.id, role: 'user', content: 'wrong role' },
      ])
    ).toThrow('AGENT_MESSAGE_ROLE_MISMATCH');
  });

  it.each(['pending', 'failed'] as const)(
    'shows an unsaved %s result once, preferring materialized text',
    persistenceStatus => {
      const history = readAgentHistoryResult(resultV2, identity);
      const saved = { ...answer, content: 'materialized content' };
      const view = mergeAgentHistoryResult(
        [question, saved],
        history,
        persistenceStatus
      );
      expect(view).toEqual({
        messages: [question, saved, activity],
        persistenceStatus,
      });
      expect(
        mergeAgentHistoryResult(view.messages, history, persistenceStatus)
      ).toEqual(view);
      expect(history.projection.messages[1].content).toBe('result copy');
    }
  );

  it('fills only unsaved missing messages and retains interleaved activity order', () => {
    const secondAnswer: Message = {
      id: 'answer2',
      role: 'assistant',
      content: 'second',
    };
    const history = readAgentHistoryResult(
      {
        ...resultV2,
        messages: [...resultV2.messages, secondAnswer],
        outputMessageIds: [...resultV2.outputMessageIds, secondAnswer.id],
      },
      identity
    );
    expect(
      mergeAgentHistoryResult([question], history, 'failed').messages
    ).toEqual([question, answer, activity, secondAnswer]);
    expect(
      mergeAgentHistoryResult([question, secondAnswer], history, 'saved')
        .messages
    ).toEqual([question, secondAnswer]);
  });

  it.each(['activity', 'reasoning'] as const)(
    'defers and then correctly places %s across a saved-result page gap',
    role => {
      const second: Message = {
        id: 'answer2',
        role: 'assistant',
        content: 'second',
      };
      const auxiliary: Message =
        role === 'activity'
          ? activity
          : { id: 'reasoning', role: 'reasoning', content: 'explanation' };
      const history = readAgentHistoryResult(
        {
          ...resultV2,
          messages: [question, answer, second, auxiliary],
          outputMessageIds: [answer.id, second.id, auxiliary.id],
        },
        identity
      );
      const firstView = mergeAgentHistoryResult(
        [question, answer],
        history,
        'saved'
      );
      expect(firstView.messages).toEqual([question, answer]);
      const nextPage = mergeAgentHistoryPage(firstView.messages, [second]);
      const finalView = mergeAgentHistoryResult(nextPage, history, 'saved');
      expect(finalView.messages).toEqual([question, answer, second, auxiliary]);
      expect(
        mergeAgentHistoryResult(
          [question, answer, auxiliary, second],
          history,
          'saved'
        ).messages
      ).toEqual(finalView.messages);
    }
  );

  it('does not overwrite materialized messages from earlier or later pages', () => {
    const before: Message = { id: 'before', role: 'user', content: 'before' };
    const after: Message = { id: 'after', role: 'user', content: 'after' };
    const history = readAgentHistoryResult(resultV2, identity);
    expect(
      mergeAgentHistoryResult(
        [before, question, answer, after],
        history,
        'saved'
      ).messages
    ).toEqual([before, question, answer, activity, after]);
  });

  it('updates result-owned activity rather than mistaking it for a materialized text row', () => {
    const running = {
      ...activity,
      content: { name: 'lookup', status: 'running' },
    };
    const history = readAgentHistoryResult(resultV2, identity);
    expect(
      mergeAgentHistoryResult([question, answer, running], history, 'saved')
        .messages
    ).toEqual([question, answer, activity]);
    expect(running.content.status).toBe('running');
  });

  it.each(['pending', 'failed', 'saved'] as const)(
    'does not refill prior-run pages or overwrite their activities when this run is %s',
    persistenceStatus => {
      const previousQuestion: Message = {
        id: 'previous-question',
        role: 'user',
        content: 'previous question',
      };
      const previousAnswer: Message = {
        id: 'previous-answer',
        role: 'assistant',
        content: 'previous answer',
      };
      const previousActivity: Message = {
        ...activity,
        id: 'previous-activity',
        content: { name: 'lookup', status: 'running' },
      };
      const previousReasoning: Message = {
        id: 'previous-reasoning',
        role: 'reasoning',
        content: 'previous explanation',
      };
      const priorPage = [
        previousQuestion,
        previousAnswer,
        {
          ...previousActivity,
          content: { name: 'lookup', status: 'completed' },
        },
        previousReasoning,
        question,
      ];
      const history = readAgentHistoryResult(
        {
          ...resultV2,
          messages: [
            previousQuestion,
            previousAnswer,
            previousActivity,
            previousReasoning,
            ...resultV2.messages,
          ],
        },
        identity
      );
      const immutable = structuredClone(history);
      const view = mergeAgentHistoryResult(
        [question],
        history,
        persistenceStatus
      );
      expect(view.messages).toEqual(
        persistenceStatus === 'saved'
          ? [question]
          : [question, answer, activity]
      );
      expect(
        mergeAgentHistoryResult(view.messages, history, persistenceStatus)
      ).toEqual(view);

      const paged = mergeAgentHistoryPage(view.messages, priorPage, 'before');
      const reconciled = mergeAgentHistoryResult(
        paged,
        history,
        persistenceStatus
      );
      expect(reconciled.messages).toEqual([
        ...priorPage,
        ...(persistenceStatus === 'saved' ? [] : [answer, activity]),
      ]);

      const storedAnswer = {
        ...answer,
        content: 'materialized current answer',
      };
      const materialized = mergeAgentHistoryPage(reconciled.messages, [
        storedAnswer,
      ]);
      const saved = mergeAgentHistoryResult(materialized, history, 'saved');
      expect(saved.messages).toEqual([...priorPage, storedAnswer, activity]);
      expect(new Set(saved.messages.map(message => message.id)).size).toBe(
        saved.messages.length
      );
      expect(mergeAgentHistoryResult(saved.messages, history, 'saved')).toEqual(
        saved
      );
      expect(history).toEqual(immutable);
    }
  );

  it.each(['pending', 'failed', 'saved'] as const)(
    'defers a current-run activity before its unloaded input anchor while %s',
    persistenceStatus => {
      const history = readAgentHistoryResult(
        { ...resultV2, messages: [question, activity, answer] },
        identity
      );
      const first = mergeAgentHistoryResult([], history, persistenceStatus);
      expect(first.messages).toEqual(
        persistenceStatus === 'saved' ? [] : [answer]
      );
      const loaded = mergeAgentHistoryPage(
        first.messages,
        [question],
        'before'
      );
      const next = mergeAgentHistoryResult(loaded, history, persistenceStatus);
      expect(next.messages).toEqual(
        persistenceStatus === 'saved'
          ? [question, activity]
          : [question, activity, answer]
      );
    }
  );

  it.each(['pending', 'failed', 'saved'] as const)(
    'reads an unscoped v2 snapshot without guessing missing output ownership while %s',
    persistenceStatus => {
      const history = readAgentHistoryResult(
        { ...resultV2, outputMessageIds: undefined },
        identity
      );
      expect(history.projection.outputMessageIds).toEqual([]);
      expect(history.projection.messages).toEqual(resultV2.messages);
      expect(history.projection.warnings).toContain(
        'history-output-scope-unavailable'
      );
      expect(
        mergeAgentHistoryResult([question], history, persistenceStatus).messages
      ).toEqual([question]);
      expect(
        mergeAgentHistoryResult(
          [question, answer, activity],
          history,
          persistenceStatus
        ).messages
      ).toEqual([question, answer, activity]);
    }
  );

  it.each(
    [
      ['missing-message'],
      [answer.id, answer.id],
      [question.id],
      [42],
      'answer',
      null,
    ].map(outputMessageIds => ({ outputMessageIds }))
  )(
    'rejects invalid v2 output ownership $outputMessageIds',
    ({ outputMessageIds }) => {
      expect(() =>
        readAgentHistoryResult({ ...resultV2, outputMessageIds }, identity)
      ).toThrow('AGENT_HISTORY_OUTPUT_SCOPE_INVALID');
    }
  );

  it('recovers legacy v1 output without requiring a new scope field', () => {
    const history = readAgentHistoryResult(
      {
        executionStatus: 'success',
        messages: [{ id: answer.id, content: answer.content }],
      },
      identity
    );
    expect(
      mergeAgentHistoryResult([question], history, 'failed').messages
    ).toEqual([question, answer]);
  });

  it('bounds history and leaves the source untouched on rejected merges', () => {
    const full = Array.from({ length: 256 }, (_, index) => ({
      id: `message-${index}`,
      role: 'assistant' as const,
      content: '',
    }));
    expect(() => mergeAgentHistoryPage(full, [answer])).toThrow(
      'AGENT_MESSAGES_INVALID'
    );
    expect(full).toHaveLength(256);
    expect(() =>
      readAgentHistoryResult(
        {
          ...resultV2,
          messages: [{ ...answer, content: 'x'.repeat(512 * 1024) }],
        },
        identity
      )
    ).toThrow('AGENT_PROJECTION_LIMIT');
  });
});
