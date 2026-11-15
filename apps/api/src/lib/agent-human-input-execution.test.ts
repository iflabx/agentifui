/** @jest-environment node */
import type { AgentApp } from './agent-app';
import {
  executeHumanInputRun,
  reconcileHumanInputRun,
} from './agent-human-input-execution';
import {
  type AgentInteractionRecord,
  markResumeSubmitting,
  releaseUndispatchedResume,
  updateInteractionOutcome,
} from './agent-interactions-repository';
import {
  type AgentRunRecord,
  bindThread,
  getRunForActor,
  markRunUnknown,
  saveRunResult,
} from './agent-runs-repository';
import {
  type AgentSubmission,
  confirmSubmission,
  markSubmissionSubmitting,
  rejectSubmission,
  rejectUnacceptedSubmission,
} from './agent-submissions';
import {
  findHumanInputRun,
  getHumanInputState,
  requireHumanInputCapabilities,
} from './langchain/human-input';
import { LangChainUpstreamError, streamNativeRun } from './langchain/transport';
import { queryRowsWithPgSystemContext } from './pg-context';

jest.mock('./agent-interactions-repository', () => ({
  markResumeSubmitting: jest.fn(),
  releaseUndispatchedResume: jest.fn(),
  updateInteractionOutcome: jest.fn(),
}));
jest.mock('./agent-runs-repository', () => ({
  bindThread: jest.fn(),
  getRunForActor: jest.fn(),
  markRunUnknown: jest.fn(),
  saveRunResult: jest.fn(),
}));
jest.mock('./agent-submissions', () => ({
  confirmSubmission: jest.fn(),
  markSubmissionSubmitting: jest.fn(),
  rejectSubmission: jest.fn(),
  rejectUnacceptedSubmission: jest.fn(),
}));
jest.mock('./pg-context', () => ({ queryRowsWithPgSystemContext: jest.fn() }));
jest.mock('./langchain/human-input', () => ({
  findHumanInputRun: jest.fn(),
  getHumanInputState: jest.fn(),
  requireHumanInputCapabilities: jest.fn(),
}));
jest.mock('./langchain/transport', () => ({
  ...jest.requireActual('./langchain/transport'),
  streamNativeRun: jest.fn(),
}));

const app = { id: 'app', humanInput: true } as AgentApp;
const initial = {
  id: 'resume',
  user_id: 'actor',
  service_instance_id: 'app',
  conversation_id: 'conversation',
  run_kind: 'resume',
  root_run_id: 'root',
  thread_id: 'thread',
  native_run_id: null,
  execution_status: 'reserved',
  persistence_status: 'pending',
  result: null,
} as AgentRunRecord;
const interaction: AgentInteractionRecord = {
  id: 'interaction',
  origin_run_id: 'root',
  native_interrupt_id: 'interrupt',
  checkpoint: { checkpoint_id: 'checkpoint' },
  prompt: {
    title: 'Confirmation',
    description: 'Synthetic operation',
    actions: ['approve', 'reject'],
    commentMaxLength: 500,
    expiresAt: null,
  },
  expires_at: null,
  status: 'submitting',
  submission_id: 'submission',
  request_hash: 'hash',
  decision: { action: 'approve', comment: '' },
  resume_run_id: initial.id,
};
let durable: AgentRunRecord;
let dispatched: boolean;
let ledger: Pick<AgentSubmission, 'root_task_id' | 'state' | 'quota_state'>;

beforeEach(() => {
  jest.resetAllMocks();
  durable = { ...initial };
  dispatched = false;
  ledger = { root_task_id: 'task', state: 'admitted', quota_state: 'reserved' };
  jest.mocked(confirmSubmission).mockResolvedValue(undefined);
  jest.mocked(getRunForActor).mockImplementation(async () => ({ ...durable }));
  jest.mocked(markRunUnknown).mockImplementation(async () => ({ ...durable }));
  jest.mocked(updateInteractionOutcome).mockResolvedValue(undefined);
  jest.mocked(requireHumanInputCapabilities).mockResolvedValue(undefined);
  jest.mocked(getHumanInputState).mockResolvedValue({
    interrupt: {
      id: 'interrupt',
      checkpoint: { checkpoint_id: 'checkpoint' },
      prompt: {} as never,
    },
    outcome: 'pending',
    messages: [],
  });
  jest.mocked(markResumeSubmitting).mockImplementation(async () => {
    durable.execution_status = 'submitting';
  });
  jest.mocked(releaseUndispatchedResume).mockImplementation(async () => {
    if (
      durable.execution_status !== 'reserved' ||
      durable.native_run_id ||
      durable.result
    )
      return false;
    durable = {
      ...durable,
      execution_status: 'error',
      persistence_status: 'saved',
      error_code: 'AGENT_RESUME_NOT_DISPATCHED',
      result: {
        executionStatus: 'error',
        messages: [],
        errorCode: 'AGENT_RESUME_NOT_DISPATCHED',
      },
    };
    return true;
  });
  jest
    .mocked(streamNativeRun)
    .mockImplementation(
      async (_app, _thread, _body, _onRun, beforeDispatch, onDispatch) => {
        await beforeDispatch();
        onDispatch();
        dispatched = true;
        throw new Error('synthetic transport failure');
      }
    );
  jest
    .mocked(queryRowsWithPgSystemContext)
    .mockImplementation(async () => [{ ...ledger }] as never);
});

function execute() {
  return executeHumanInputRun({
    app,
    run: initial,
    interaction,
    content: '',
    emit: jest.fn(),
    agui: { emit: jest.fn() },
    report: jest.fn(),
  });
}

it('releases a capabilities failure only through the durable reserved proof', async () => {
  jest
    .mocked(requireHumanInputCapabilities)
    .mockRejectedValueOnce(new Error('preparation failed'));
  await execute();
  expect(streamNativeRun).not.toHaveBeenCalled();
  expect(durable.error_code).toBe('AGENT_RESUME_NOT_DISPATCHED');
  expect(markRunUnknown).not.toHaveBeenCalled();
  expect(updateInteractionOutcome).not.toHaveBeenCalled();
});

it('rejects a changed checkpoint before attempting the final claim or a native POST', async () => {
  jest.mocked(getHumanInputState).mockResolvedValueOnce({
    interrupt: {
      id: 'interrupt',
      checkpoint: { checkpoint_id: 'changed' },
      prompt: {} as never,
    },
    outcome: 'pending',
    messages: [],
  });
  await execute();
  expect(markResumeSubmitting).not.toHaveBeenCalled();
  expect(streamNativeRun).not.toHaveBeenCalled();
  expect(durable.error_code).toBe('AGENT_RESUME_NOT_DISPATCHED');
});

it('does not erase reserved proof or mark unknown when the release transaction fails', async () => {
  jest
    .mocked(requireHumanInputCapabilities)
    .mockRejectedValueOnce(new Error('preparation failed'));
  jest
    .mocked(releaseUndispatchedResume)
    .mockRejectedValueOnce(new Error('storage failed'));
  await execute();
  expect(durable.execution_status).toBe('reserved');
  expect(markRunUnknown).not.toHaveBeenCalled();
});

it('uses durable submitting after a lost commit acknowledgment, not the local undispatched flag', async () => {
  jest.mocked(markResumeSubmitting).mockImplementationOnce(async () => {
    durable.execution_status = 'submitting';
    throw new Error('commit acknowledgment lost');
  });
  await execute();
  expect(dispatched).toBe(false);
  expect(durable.execution_status).toBe('submitting');
  expect(markRunUnknown).toHaveBeenCalledWith(initial.id);
  expect(updateInteractionOutcome).toHaveBeenCalledWith(initial.id, 'unknown');
  expect(saveRunResult).not.toHaveBeenCalled();
});

it('never releases a submitting transport failure even with no recorded native run', async () => {
  await execute();
  expect(dispatched).toBe(true);
  expect(durable.native_run_id).toBeNull();
  expect(markRunUnknown).toHaveBeenCalledWith(initial.id);
  expect(updateInteractionOutcome).toHaveBeenCalledWith(initial.id, 'unknown');
});

it('does not let a stale worker overwrite a safely failed run or a replacement claim', async () => {
  jest.mocked(markResumeSubmitting).mockImplementationOnce(async () => {
    await releaseUndispatchedResume(initial.id);
    throw new Error('another actor released the reserved claim');
  });
  await execute();
  expect(dispatched).toBe(false);
  expect(durable.error_code).toBe('AGENT_RESUME_NOT_DISPATCHED');
  expect(markRunUnknown).not.toHaveBeenCalled();
  expect(updateInteractionOutcome).not.toHaveBeenCalled();
});

it('leaves normal reserved preparation alone during reconciliation', async () => {
  expect(
    (await reconcileHumanInputRun({ app, run: initial, interaction }))
      .execution_status
  ).toBe('reserved');
  expect(releaseUndispatchedResume).not.toHaveBeenCalled();
  expect(findHumanInputRun).not.toHaveBeenCalled();
  expect(getHumanInputState).not.toHaveBeenCalled();
});

it.each(['failed', 'saved'] as const)(
  'idempotently finishes the root ledger for a known error result with persistence=%s, without native reads',
  async persistence => {
    durable = {
      ...durable,
      run_kind: 'turn',
      native_run_id: 'accepted-native-run',
      execution_status: 'error',
      persistence_status: persistence,
      result: {
        executionStatus: 'error',
        messages: [],
        errorCode: 'AGENT_RUN_FAILED',
      },
    };
    jest
      .mocked(saveRunResult)
      .mockResolvedValue({ ...durable, persistence_status: 'saved' });
    await reconcileHumanInputRun({ app, run: durable });
    expect(confirmSubmission).toHaveBeenCalledWith('task', 'finished');
    expect(saveRunResult).toHaveBeenCalledTimes(
      persistence === 'saved' ? 0 : 1
    );
    expect(findHumanInputRun).not.toHaveBeenCalled();
    expect(getHumanInputState).not.toHaveBeenCalled();
  }
);

describe('first human-input turn acceptance evidence', () => {
  beforeEach(() => {
    durable = { ...initial, run_kind: 'turn', root_run_id: undefined };
    jest.mocked(bindThread).mockImplementation(async () => ({ ...durable }));
    jest.mocked(markRunUnknown).mockImplementation(async () => {
      durable.execution_status = 'unknown';
      return { ...durable };
    });
    jest.mocked(markSubmissionSubmitting).mockImplementation(async () => {
      ledger.state = 'submitting';
    });
    jest.mocked(rejectSubmission).mockImplementation(async () => {
      if (['registered', 'admitted'].includes(ledger.state)) {
        ledger.state = 'rejected';
        ledger.quota_state = 'released';
      }
    });
    jest.mocked(rejectUnacceptedSubmission).mockImplementation(async () => {
      if (ledger.state === 'submitting' && ledger.quota_state === 'reserved') {
        ledger.state = 'rejected';
        ledger.quota_state = 'released';
      }
    });
    jest.mocked(saveRunResult).mockImplementation(async (_id, result) => {
      durable = {
        ...durable,
        execution_status: result.executionStatus,
        result,
        persistence_status: 'saved',
      };
      return { ...durable };
    });
  });

  function executeTurn() {
    return executeHumanInputRun({
      app,
      run: durable,
      rootTaskId: 'task',
      content: 'Synthetic input',
      emit: jest.fn(),
      agui: { emit: jest.fn() },
      report: jest.fn(),
    });
  }

  it('keeps a committed submission unknown when its COMMIT acknowledgment is lost', async () => {
    jest.mocked(markSubmissionSubmitting).mockImplementationOnce(async () => {
      ledger.state = 'submitting';
      throw new Error('commit acknowledgment lost');
    });
    jest.mocked(findHumanInputRun).mockResolvedValue(undefined);
    await executeTurn();
    expect(dispatched).toBe(false);
    expect(durable.execution_status).toBe('unknown');
    expect(durable.result).toBeNull();
    expect(ledger).toMatchObject({
      state: 'submitting',
      quota_state: 'reserved',
    });
    expect(saveRunResult).not.toHaveBeenCalled();
    expect(rejectUnacceptedSubmission).not.toHaveBeenCalled();
    await reconcileHumanInputRun({ app, run: durable });
    await reconcileHumanInputRun({ app, run: durable });
    expect(confirmSubmission).not.toHaveBeenCalledWith('task', 'accepted');
    expect(confirmSubmission).not.toHaveBeenCalledWith('task', 'finished');
    expect(streamNativeRun).toHaveBeenCalledTimes(1);
  });

  it('saves a preparation error only after durable rejection is confirmed', async () => {
    jest
      .mocked(requireHumanInputCapabilities)
      .mockRejectedValueOnce(new Error('preparation failed'));
    await executeTurn();
    expect(dispatched).toBe(false);
    expect(ledger).toMatchObject({
      state: 'rejected',
      quota_state: 'released',
    });
    expect(durable.result?.executionStatus).toBe('error');
    await reconcileHumanInputRun({ app, run: durable });
    expect(confirmSubmission).not.toHaveBeenCalledWith('task', 'finished');
  });

  it('accepts durable rejection after its acknowledgment is lost', async () => {
    jest
      .mocked(requireHumanInputCapabilities)
      .mockRejectedValueOnce(new Error('preparation failed'));
    jest.mocked(rejectSubmission).mockImplementationOnce(async () => {
      ledger.state = 'rejected';
      ledger.quota_state = 'released';
      throw new Error('rejection acknowledgment lost');
    });
    await executeTurn();
    expect(durable.result?.executionStatus).toBe('error');
    expect(markRunUnknown).not.toHaveBeenCalled();
  });

  it.each(['read', 'reject'])(
    'does not finalize a preparation error when %s cannot be confirmed',
    async failure => {
      jest
        .mocked(requireHumanInputCapabilities)
        .mockRejectedValueOnce(new Error('preparation failed'));
      if (failure === 'read')
        jest
          .mocked(queryRowsWithPgSystemContext)
          .mockRejectedValueOnce(new Error('read failed'));
      else
        jest
          .mocked(rejectSubmission)
          .mockRejectedValueOnce(new Error('rejection failed'));
      await executeTurn();
      expect(durable.execution_status).toBe('unknown');
      expect(saveRunResult).not.toHaveBeenCalled();
      expect(ledger.quota_state).toBe('reserved');
    }
  );

  it('releases a dispatched explicit native refusal without counting it', async () => {
    jest
      .mocked(streamNativeRun)
      .mockImplementationOnce(
        async (_app, _thread, _body, _onRun, beforeDispatch, onDispatch) => {
          await beforeDispatch();
          onDispatch();
          dispatched = true;
          throw new LangChainUpstreamError('UPSTREAM_HTTP_ERROR', 400);
        }
      );
    await executeTurn();
    expect(dispatched).toBe(true);
    expect(ledger).toMatchObject({
      state: 'rejected',
      quota_state: 'released',
    });
    expect(durable.result?.executionStatus).toBe('error');
    expect(confirmSubmission).not.toHaveBeenCalled();
  });

  it('does not release a dispatched transport failure without acceptance evidence', async () => {
    await executeTurn();
    expect(dispatched).toBe(true);
    expect(durable.execution_status).toBe('unknown');
    expect(saveRunResult).not.toHaveBeenCalled();
    expect(ledger.quota_state).toBe('reserved');
  });

  it.each(['reserved', 'exempt'] as const)(
    'does not confirm a local error with only %s quota evidence',
    async quota => {
      ledger = { root_task_id: 'task', state: 'unknown', quota_state: quota };
      durable = {
        ...durable,
        execution_status: 'error',
        persistence_status: 'saved',
        result: { executionStatus: 'error', messages: [] },
      };
      await reconcileHumanInputRun({ app, run: durable });
      expect(confirmSubmission).not.toHaveBeenCalled();
    }
  );

  it.each(['accepted', 'counted', 'native'] as const)(
    'finishes a saved error only with %s acceptance evidence',
    async evidence => {
      if (evidence === 'accepted') ledger.state = 'accepted';
      if (evidence === 'counted') ledger.quota_state = 'counted';
      durable = {
        ...durable,
        native_run_id: evidence === 'native' ? 'native' : null,
        execution_status: 'error',
        persistence_status: 'saved',
        result: { executionStatus: 'error', messages: [] },
      };
      await reconcileHumanInputRun({ app, run: durable });
      expect(confirmSubmission).toHaveBeenCalledWith('task', 'finished');
    }
  );
});
