import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';

import { useState } from 'react';

import { correctionDraft, useEditResend } from './edit-resend';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    onConfirm,
    onClose,
    isLoading,
  }: {
    onConfirm: () => void;
    onClose: () => void;
    isLoading: boolean;
  }) => (
    <div role="dialog">
      <button onClick={onConfirm} disabled={isLoading}>
        confirm
      </button>
      <button onClick={onClose}>cancel</button>
    </div>
  ),
}));

const source = {
  id: 'original',
  text: 'original question',
  hasAttachments: true,
};
function Harness({
  scope = 'actor/app/conversation',
  blocked = false,
  initial = '',
  files = false,
}: {
  scope?: string;
  blocked?: boolean;
  initial?: string;
  files?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [attachments, setAttachments] = useState(files);
  const edit = useEditResend({
    scope,
    blocked,
    value,
    hasDraftAttachments: attachments,
    replace: text => {
      setValue(text);
      setAttachments(false);
      return true;
    },
  });
  return (
    <>
      <button
        onClick={() => edit.controls.start(source)}
        disabled={edit.controls.disabled}
      >
        edit
      </button>
      <textarea
        ref={edit.onInputRef}
        value={value}
        onChange={event => setValue(event.target.value)}
      />
      <span data-testid="files">{String(attachments)}</span>
      {edit.notice}
      {edit.confirmation}
    </>
  );
}

describe('edit and append preparation', () => {
  it('prepares only the full original text without a visible correction prompt', () => {
    const original = '😀'.repeat(121) + '\nfull body';
    const draft = correctionDraft(original);
    expect(draft.text.slice(draft.selectionStart, draft.selectionEnd)).toBe(
      original
    );
    expect(draft.text).toBe(original);
  });

  it('prepares once, focuses new requirements, and exits without removing visible text', () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('edit'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    const prepared = input.value;
    expect(prepared).toContain('original question');
    expect(input).toHaveFocus();
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe(
      source.text
    );
    expect(screen.getByRole('status')).toHaveTextContent('textOnly');
    view.rerender(<Harness />);
    expect(input.value).toBe(prepared);
    fireEvent.click(screen.getByText('exit'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(input.value).toBe(prepared);
    fireEvent.change(input, { target: { value: 'only my new requirement' } });
    expect(input.value).toBe('only my new requirement');
  });

  it.each([
    { initial: 'draft', files: false },
    { initial: '', files: true },
  ])(
    'confirms replacement and preserves draft/attachments on cancel: %j',
    props => {
      render(<Harness {...props} />);
      fireEvent.click(screen.getByText('edit'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      fireEvent.click(screen.getByText('cancel'));
      expect(screen.getByRole('textbox')).toHaveValue(props.initial);
      expect(screen.getByTestId('files')).toHaveTextContent(
        String(props.files)
      );
      fireEvent.click(screen.getByText('edit'));
      fireEvent.click(screen.getByText('confirm'));
      expect(
        (screen.getByRole('textbox') as HTMLTextAreaElement).value
      ).toContain('original question');
      expect(screen.getByTestId('files')).toHaveTextContent('false');
    }
  );

  it('dismisses metadata on scope change and cannot confirm while blocked', () => {
    const view = render(<Harness initial="draft" />);
    fireEvent.click(screen.getByText('edit'));
    view.rerender(<Harness initial="draft" blocked />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('draft');
    view.rerender(<Harness scope="other-actor/app/conversation" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('edit'));
    fireEvent.click(screen.getByText('confirm'));
    view.rerender(<Harness scope="other-app/conversation" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('rejects a stale callback, blank text and a failed scope replacement', () => {
    const replace = jest.fn(() => false);
    const hook = renderHook(
      ({ scope }) =>
        useEditResend({ scope, value: '', blocked: false, replace }),
      { initialProps: { scope: 'A' } }
    );
    const stale = hook.result.current.controls.start;
    hook.rerender({ scope: 'B' });
    act(() => stale(source));
    act(() =>
      hook.result.current.controls.start({ id: 'blank', text: ' \n ' })
    );
    expect(replace).not.toHaveBeenCalled();
    act(() => hook.result.current.controls.start(source));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(hook.result.current.notice).toBeNull();
  });

  it('dismisses the notice when the normal draft consumer clears the text', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
