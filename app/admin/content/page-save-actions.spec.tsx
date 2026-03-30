import { render, screen } from '@testing-library/react';

import { ContentSaveActions } from './page-save-actions';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock('lucide-react', () => ({
  Languages: () => <svg data-testid="languages-icon" />,
}));

describe('ContentSaveActions', () => {
  const baseProps = {
    hasChanges: false,
    isSaving: false,
    isTranslating: false,
    isTranslateDisabled: false,
    onReset: jest.fn(),
    onSave: jest.fn(),
    onTranslateAll: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reserves fixed-height status rows when there is no message', () => {
    render(<ContentSaveActions {...baseProps} />);

    expect(screen.getByTestId('save-actions-has-changes-row')).toHaveClass(
      'h-5'
    );
    expect(screen.getByTestId('save-actions-translate-reason-row')).toHaveClass(
      'h-5'
    );
    expect(
      screen.queryByText('pages.admin.content.page.saveActions.hasChanges')
    ).not.toBeInTheDocument();
  });

  it('shows change and translate-disabled messages inside the reserved rows', () => {
    render(
      <ContentSaveActions
        {...baseProps}
        hasChanges={true}
        isTranslateDisabled={true}
        translateDisabledReason="save first"
      />
    );

    expect(screen.getByText('saveActions.hasChanges')).toBeInTheDocument();
    expect(screen.getByText('save first')).toHaveClass('block', 'truncate');
    expect(
      screen.getByRole('button', { name: /translateAll/i })
    ).toBeDisabled();
  });
});
