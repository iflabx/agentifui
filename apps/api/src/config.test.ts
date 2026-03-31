/** @jest-environment node */
import { loadApiRuntimeConfig } from './config';

describe('loadApiRuntimeConfig input moderation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DIFY_INPUT_MODERATION_ENABLED;
    delete process.env.DIFY_INPUT_MODERATION_APP;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps input moderation disabled when the flag is not enabled', () => {
    const config = loadApiRuntimeConfig();

    expect(config.inputModeration).toEqual({
      enabled: false,
      app: null,
    });
  });

  it('ignores malformed moderation app config while the feature is disabled', () => {
    process.env.DIFY_INPUT_MODERATION_APP = '{invalid';

    expect(() => loadApiRuntimeConfig()).not.toThrow();
  });

  it('loads the moderation app config when enabled', () => {
    process.env.DIFY_INPUT_MODERATION_ENABLED = 'true';
    process.env.DIFY_INPUT_MODERATION_APP = JSON.stringify({
      apiUrl: 'https://moderation.example.com/v1',
      apiKey: 'app-123',
    });

    const config = loadApiRuntimeConfig();

    expect(config.inputModeration).toEqual({
      enabled: true,
      app: {
        apiUrl: 'https://moderation.example.com/v1',
        apiKey: 'app-123',
      },
    });
  });

  it('throws when moderation is enabled without an app config', () => {
    process.env.DIFY_INPUT_MODERATION_ENABLED = 'true';

    expect(() => loadApiRuntimeConfig()).toThrow(
      'DIFY_INPUT_MODERATION_ENABLED=true requires DIFY_INPUT_MODERATION_APP'
    );
  });

  it('throws when the moderation app config is invalid JSON', () => {
    process.env.DIFY_INPUT_MODERATION_ENABLED = 'true';
    process.env.DIFY_INPUT_MODERATION_APP = '{invalid';

    expect(() => loadApiRuntimeConfig()).toThrow(
      'Invalid DIFY_INPUT_MODERATION_APP JSON'
    );
  });

  it('throws when the moderation app config is missing required fields', () => {
    process.env.DIFY_INPUT_MODERATION_ENABLED = 'true';
    process.env.DIFY_INPUT_MODERATION_APP = JSON.stringify({
      apiUrl: 'https://moderation.example.com/v1',
    });

    expect(() => loadApiRuntimeConfig()).toThrow(
      'Invalid DIFY_INPUT_MODERATION_APP: apiUrl and apiKey are required'
    );
  });
});
