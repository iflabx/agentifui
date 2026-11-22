import type {
  EditRecoveryReceipt,
  EditSubmissionResult,
} from '@lib/types/message-edit';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';

import { type EditSource, useEditResend } from './edit-resend';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const source = {
  id: 'original',
  text: 'original question',
  hasAttachments: true,
};
function Harness({
  scope = 'actor/app/conversation',
  blocked = false,
  submit = async () => true,
  recovery,
}: {
  scope?: string | null;
  blocked?: boolean;
  submit?: (
    text: string,
    selected: EditSource
  ) => Promise<EditSubmissionResult>;
  recovery?: EditRecoveryReceipt;
}) {
  const edit = useEditResend({ scope, blocked, onSubmit: submit, recovery });
  return (
    <>
      <button
        disabled={edit.controls.disabled}
        onClick={() => edit.controls.start(source)}
      >
        edit
      </button>
      <article data-testid="original-message">
        {edit.controls.editor || source.text}
      </article>
      {!edit.controls.pending && <p>original answer and later turns</p>}
      <textarea
        aria-label="bottom draft"
        defaultValue="unsent draft"
        disabled={edit.active}
      />
    </>
  );
}

describe('inline historical message editing', () => {
  it('restores an in-memory unknown edit when returning to its conversation', () => {
    const hook = renderHook(
      ({ scope }) =>
        useEditResend({
          scope,
          sourceIds: ['source'],
          blocked: true,
          onSubmit: jest.fn(),
          restore: {
            sourceId: 'source',
            text: 'saved revision',
            submissionId: 'pending',
          },
        }),
      { initialProps: { scope: 'returned-thread' as string | null } }
    );
    expect(hook.result.current.controls.pending).toEqual({
      sourceId: 'source',
      text: 'saved revision',
    });
    hook.rerender({ scope: null });
    expect(hook.result.current.active).toBe(false);
    hook.rerender({ scope: 'returned-thread' });
    expect(hook.result.current.controls.pending?.text).toBe('saved revision');
  });
  it('replaces immediately, then restores the old path and revised draft on definite rejection', async () => {
    let reject!: (result: boolean) => void;
    const submit = jest.fn(
      () =>
        new Promise<boolean>(resolve => {
          reject = resolve;
        })
    );
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.change(screen.getByRole('textbox', { name: 'editorLabel' }), {
      target: { value: 'replacement' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByTestId('original-message')).toHaveTextContent(
      'replacement'
    );
    expect(
      screen.queryByText('original answer and later turns')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toHaveValue(
      'unsent draft'
    );
    await act(async () => reject(false));
    expect(
      screen.getByText('original answer and later turns')
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'editorLabel' })).toHaveValue(
      'replacement'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('sendFailed');
  });

  it('checks an uncertain submission read-only and restores only after a confirmed rejection', async () => {
    const check = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(false);
    const submit = jest
      .fn()
      .mockResolvedValue({ status: 'unknown', submissionId: 'attempt', check });
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.change(screen.getByRole('textbox', { name: 'editorLabel' }), {
      target: { value: 'revision' },
    });
    await act(async () => fireEvent.submit(screen.getByRole('form')));
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: 'checkStatus' }))
      );
      expect(screen.queryByRole('form')).not.toBeInTheDocument();
      expect(
        screen.queryByText('original answer and later turns')
      ).not.toBeInTheDocument();
    }
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'checkStatus' }))
    );
    expect(screen.getByRole('textbox', { name: 'editorLabel' })).toHaveValue(
      'revision'
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('matches asynchronous recovery to the exact submission and ignores stale results after navigation', async () => {
    const submit = jest
      .fn()
      .mockResolvedValue({ status: 'unknown', submissionId: 'attempt' });
    const view = render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => fireEvent.submit(screen.getByRole('form')));
    view.rerender(
      <Harness
        submit={submit}
        recovery={{ submissionId: 'other', accepted: false }}
      />
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    view.rerender(
      <Harness
        submit={submit}
        recovery={{ submissionId: 'attempt', accepted: false }}
      />
    );
    expect(screen.getByRole('textbox', { name: 'editorLabel' })).toHaveValue(
      source.text
    );
    let finish!: (result: boolean) => void;
    submit.mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          finish = resolve;
        })
    );
    await act(async () => fireEvent.submit(screen.getByRole('form')));
    view.rerender(<Harness scope="other" submit={submit} />);
    await act(async () => finish(false));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toBeEnabled();
  });

  it('edits at the message and preserves the bottom draft on cancel', () => {
    const submit = jest.fn();
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', {
      name: 'editorLabel',
    }) as HTMLTextAreaElement;
    expect(screen.getByTestId('original-message')).toContainElement(editor);
    expect(editor).toHaveValue(source.text);
    expect(editor).toHaveFocus();
    expect(editor.selectionEnd - editor.selectionStart).toBe(
      source.text.length
    );
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toHaveValue(
      'unsent draft'
    );
    expect(
      screen.getByRole('textbox', { name: 'bottom draft' })
    ).toBeDisabled();
    expect(screen.getByText('textOnly')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByTestId('original-message')).toHaveTextContent(
      source.text
    );
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toBeEnabled();
  });

  it('retains rejected changes and closes only after explicit acceptance', async () => {
    const submit = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.change(editor, { target: { value: 'updated question' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(submit).toHaveBeenLastCalledWith('updated question', source);
    expect(screen.getByRole('textbox', { name: 'editorLabel' })).toHaveValue(
      'updated question'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('sendFailed');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toHaveValue(
      'unsent draft'
    );
  });

  it('does not treat a thrown transport failure as a definite rejection', async () => {
    const submit = jest.fn().mockRejectedValue(new Error('offline'));
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.change(editor, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'retryable text' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByTestId('original-message')).toHaveTextContent(
      'retryable text'
    );
    expect(screen.getByRole('status')).toHaveTextContent('unconfirmed');
    expect(
      screen.queryByText('original answer and later turns')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'bottom draft' })
    ).toBeDisabled();
  });

  it('serializes sends and does not cancel a pending request', async () => {
    let finish!: (accepted: boolean) => void;
    const submit = jest.fn(
      () =>
        new Promise<boolean>(resolve => {
          finish = resolve;
        })
    );
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const form = screen.getByRole('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'cancel' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('sending');
    expect(
      screen.queryByText('original answer and later turns')
    ).not.toBeInTheDocument();
    await act(async () => {
      finish(true);
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('keeps Enter as newline, ignores IME shortcuts and cancels with Escape', () => {
    const submit = jest.fn();
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('retains temporarily blocked editing but clears it on navigation', () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.change(screen.getByRole('textbox', { name: 'editorLabel' }), {
      target: { value: 'changed' },
    });
    view.rerender(<Harness blocked />);
    expect(screen.getByRole('textbox', { name: 'editorLabel' })).toHaveValue(
      'changed'
    );
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    view.rerender(<Harness scope="other/conversation" />);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('ignores stale callbacks, absent scopes and empty sources', () => {
    const hook = renderHook(
      ({ scope }) =>
        useEditResend({ scope, blocked: false, onSubmit: jest.fn() }),
      { initialProps: { scope: 'A' as string | null } }
    );
    const stale = hook.result.current.controls.start;
    hook.rerender({ scope: 'B' });
    act(() => stale(source));
    act(() =>
      hook.result.current.controls.start({ id: 'blank', text: ' \n ' })
    );
    expect(hook.result.current.active).toBe(false);
    hook.rerender({ scope: null });
    act(() => hook.result.current.controls.start(source));
    expect(hook.result.current.active).toBe(false);
  });

  it('clears an edit after recovery removes its source from the visible history', () => {
    const hook = renderHook(
      ({ sourceIds }) =>
        useEditResend({
          scope: 'same-thread',
          sourceIds,
          blocked: false,
          onSubmit: jest.fn(),
        }),
      { initialProps: { sourceIds: ['original', 'old-answer'] } }
    );
    act(() => hook.result.current.controls.start(source));
    expect(hook.result.current.active).toBe(true);
    hook.rerender({ sourceIds: ['replacement', 'new-answer'] });
    expect(hook.result.current.active).toBe(false);
    expect(hook.result.current.controls.editor).toBeNull();
    expect(hook.result.current.controls.disabled).toBe(false);
  });
});
