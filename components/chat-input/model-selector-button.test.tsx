import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { ModelSelectorButton } from './model-selector-button';

const mockSwitch = jest.fn();
const mockClear = jest.fn();
const mockFetch = jest.fn();
const mockApps = [
  {
    id: 'a',
    instance_id: 'model-a',
    display_name: 'Model A',
    config: { app_metadata: { app_type: 'model' } },
  },
  {
    id: 'b',
    instance_id: 'model-b',
    display_name: 'Model B',
    config: { app_metadata: { app_type: 'model' } },
  },
  {
    id: 'c',
    instance_id: 'app-c',
    display_name: 'Workflow App',
    config: { app_metadata: { app_type: 'marketplace' } },
  },
];
let mockCurrentAppId = 'model-a';
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({
    currentAppId: mockCurrentAppId,
    switchToSpecificApp: mockSwitch,
    isValidating: false,
  }),
}));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: () => ({
    apps: mockApps,
    fetchApps: mockFetch,
    isLoading: false,
  }),
}));
jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: (select: (state: { clearMessages: () => void }) => unknown) =>
    select({ clearMessages: mockClear }),
}));

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
  jest.clearAllMocks();
  localStorage.clear();
  mockCurrentAppId = 'model-a';
  mockSwitch.mockResolvedValue(undefined);
});

afterEach(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

it('opens a portal menu with only models and switches without navigating', async () => {
  const path = window.location.pathname;
  const view = render(
    <div className="overflow-hidden">
      <ModelSelectorButton />
    </div>
  );
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveTextContent('Model A');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = await screen.findByRole('listbox');
  expect(view.container).not.toContainElement(menu);
  expect(within(menu).getAllByRole('option')).toHaveLength(2);
  expect(within(menu).queryByText('Workflow App')).not.toBeInTheDocument();
  const option = within(menu).getByText('Model B').closest('[role="option"]');
  expect(option).not.toBeNull();
  fireEvent.keyDown(option!, { key: 'Enter' });
  await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith('model-b'));
  await waitFor(() =>
    expect(localStorage.getItem('last-used-model-app-id')).toBe('model-b')
  );
  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe(path);
});

it('restores the last model after leaving a non-model app', async () => {
  mockCurrentAppId = 'app-c';
  localStorage.setItem('last-used-model-app-id', 'model-b');
  render(<ModelSelectorButton />);
  await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith('model-b'));
  expect(mockClear).not.toHaveBeenCalled();
});

it('does not switch models while a response is in progress', () => {
  render(<ModelSelectorButton disabled />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(mockSwitch).not.toHaveBeenCalled();
});
