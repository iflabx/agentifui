import { fireEvent, render, screen } from '@testing-library/react';

import { AppCard } from './app-card';

const addFavorite = jest.fn();
jest.mock('@lib/stores/favorite-apps-store', () => ({
  useFavoriteAppsStore: () => ({
    addFavoriteApp: addFavorite,
    removeFavoriteApp: jest.fn(),
    isFavorite: () => false,
  }),
}));
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { name?: string }) =>
    values?.name ? key + ' ' + values.name : key,
}));
const app = {
  instanceId: 'native-instance',
  displayName: 'Example',
  description: 'Administrator supplied description',
  appType: 'marketplace' as const,
  config: {
    backend_type: 'dify',
    app_metadata: { app_type: 'marketplace', dify_apptype: 'chatflow' },
  },
};
beforeEach(() => jest.clearAllMocks());

it.each(['grid', 'list'] as const)(
  'reuses the description and keeps explicit open/favorite controls in %s',
  viewMode => {
    const open = jest.fn();
    render(<AppCard app={app} viewMode={viewMode} onClick={open} />);
    expect(screen.getByText(app.description)).toBeInTheDocument();
    expect(screen.getByText('entryModes.conversation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moreDescription' }));
    expect(
      screen.getByRole('button', { name: 'lessDescription' })
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(app.description)).toHaveClass(
      'relative',
      'z-10',
      'cursor-text'
    );
    fireEvent.click(screen.getByText(app.description));
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'appCard.addFavorite' })
    );
    expect(addFavorite).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'native-instance',
        description: app.description,
      })
    );
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'appCard.openApp Example' })
    );
    expect(open).toHaveBeenCalledWith(app);
  }
);

it('shows only the configured text-only entry restriction', () => {
  render(
    <AppCard
      app={{
        ...app,
        config: {
          backend_type: 'dify',
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
        },
      }}
      viewMode="grid"
      onClick={jest.fn()}
    />
  );
  expect(screen.getByText('configuredInputs')).toBeInTheDocument();
});

it('does not infer capabilities from the LangChain brand', () => {
  render(
    <AppCard
      app={{ ...app, config: { backend_type: 'langchain' } }}
      viewMode="list"
      onClick={jest.fn()}
    />
  );
  expect(screen.queryByText('entryModes.text')).not.toBeInTheDocument();
  expect(screen.queryByText('entryModes.conversation')).not.toBeInTheDocument();
  expect(screen.queryByText('configuredInputs')).not.toBeInTheDocument();
});

it('uses the existing safe platform text capability without claiming files or results', () => {
  render(
    <AppCard
      app={{
        ...app,
        instanceId: 'service-uuid',
        config: {
          backend_type: 'langchain',
          langchain: { capabilities: { text: true } },
        },
      }}
      viewMode="grid"
      onClick={jest.fn()}
    />
  );
  expect(screen.getByText('entryModes.text')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'appCard.addFavorite' }));
  expect(addFavorite).toHaveBeenCalledWith(
    expect.objectContaining({
      backendType: 'langchain',
      serviceInstanceId: 'service-uuid',
      instanceId: 'service-uuid',
    })
  );
});

it('does not invent a missing description or mode', () => {
  render(
    <AppCard
      app={{ ...app, description: undefined, config: {} }}
      viewMode="grid"
      onClick={jest.fn()}
    />
  );
  expect(screen.getByText('noDescription')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'moreDescription' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('entryModes.conversation')).not.toBeInTheDocument();
});
