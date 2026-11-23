import { fireEvent, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import type { AgentAttachmentSlot } from '../../packages/shared/src/agent-input';
import { AttachmentAction, attachmentAccept } from './attachment-action';
import { FileTypeSelector } from './file-type-selector';

jest.mock('./button', () => ({
  ChatButton: ({
    ariaLabel,
    disabled,
    onClick,
  }: {
    ariaLabel: string;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    />
  ),
}));
jest.mock('@components/ui/popover', () => ({
  Popover: ({
    trigger,
    children,
    isOpen,
    onOpenChange,
  }: {
    trigger: ReactNode;
    children: ReactNode;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <div onClick={() => onOpenChange(!isOpen)}>{trigger}</div>
      {isOpen && children}
    </div>
  ),
}));

const slot: AgentAttachmentSlot = {
  key: 'docs',
  label: 'Documents',
  target: 'inputs',
  minCount: 1,
  maxCount: 2,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['txt', 'pdf'],
  maxBytesByType: { document: 100 },
};

describe('shared attachment action', () => {
  it('opens a single upload purpose directly and disables it when full', () => {
    const onChoose = jest.fn();
    const choice = { id: 'docs', slot, count: 0 };
    const view = render(
      <AttachmentAction
        choices={[choice]}
        onChoose={onChoose}
        ariaLabel="Attach"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onChoose).toHaveBeenCalledWith(choice);
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('attachmentRange');
    view.rerender(
      <AttachmentAction
        choices={[{ ...choice, count: 2 }]}
        onChoose={onChoose}
        ariaLabel="Attach"
      />
    );
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('attachmentSelected');
  });

  it('selects a purpose only for multiple slots, preserving individual limits', () => {
    const onChoose = jest.fn();
    render(
      <AttachmentAction
        choices={[
          { id: 'full', slot, count: 2 },
          {
            id: 'available',
            slot: { ...slot, key: 'second', label: 'Reference' },
            count: 0,
          },
          {
            id: 'remote',
            slot: {
              ...slot,
              key: 'remote',
              label: 'Remote',
              methods: ['remote_url'],
            },
            count: 0,
          },
        ]}
        onChoose={onChoose}
        ariaLabel="Attach"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Documents/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Remote/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Reference/ }));
    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'available' })
    );
  });

  it('disables unavailable capabilities without a fabricated file count', () => {
    render(
      <AttachmentAction choices={[]} onChoose={jest.fn()} ariaLabel="Attach" />
    );
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['loading', 'unavailable'] as const)(
    'distinguishes %s requirements from unsupported uploads',
    status => {
      const onChoose = jest.fn();
      render(
        <AttachmentAction
          choices={[{ id: 'docs', slot, count: 0 }]}
          status={status}
          onChoose={onChoose}
          ariaLabel="Attach"
        />
      );
      expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent(
        status === 'loading'
          ? 'fileTypeSelector.loading'
          : 'fileTypeSelector.loadError'
      );
      fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
      expect(onChoose).not.toHaveBeenCalled();
    }
  );

  it('keeps native selection independent of React remounts and combines accepted formats', () => {
    const onFileSelect = jest.fn();
    const config = {
      slot,
      capabilities: null,
      isLoading: false,
      error: null,
      retry: jest.fn(),
      fileTypes: [
        {
          title: 'document',
          extensions: ['txt', 'pdf'],
          acceptString: '.txt,.pdf',
          maxSize: '100 B',
          icon: null,
        },
      ],
      uploadConfig: {
        enabled: true,
        maxFiles: 2,
        supportedMethods: ['local_file'],
        hasFileTypes: true,
        allowedExtensions: ['txt', 'pdf'],
      },
    } as Parameters<typeof FileTypeSelector>[0]['config'];
    const view = render(
      <FileTypeSelector
        config={config}
        attachmentCount={0}
        onFileSelect={onFileSelect}
        ariaLabel="Attach"
      />
    );
    const click = jest
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(click).toHaveBeenCalledTimes(1);
    const input = click.mock.contexts[0] as HTMLInputElement;
    expect(input).toHaveAttribute('accept', '.txt,.pdf');
    expect(input.multiple).toBe(true);
    expect(attachmentAccept(slot)).toBe('.txt,.pdf');
    const files = [new File(['text'], 'notes.txt')];
    view.unmount();
    fireEvent.change(input, { target: { files } });
    expect(onFileSelect).toHaveBeenCalledWith(files, '.txt,.pdf');
    render(
      <FileTypeSelector
        config={config}
        attachmentCount={2}
        onFileSelect={onFileSelect}
        ariaLabel="Attach"
      />
    );
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(onFileSelect).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
