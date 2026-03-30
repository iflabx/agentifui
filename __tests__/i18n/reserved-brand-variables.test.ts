/**
 * @jest-environment node
 */
import { resolveReservedVariablesDeep } from '@lib/config/branding';

describe('reserved brand variables', () => {
  it('replaces only reserved variables inside message objects', () => {
    const now = new Date('2026-03-30T00:00:00.000Z');
    const messages = {
      dynamicTitle: {
        base: '{productName}',
        mixed: 'Start with {appName} on {productName}',
      },
      footer: {
        copyright: '© {year} {projectName}',
      },
      list: ['Visit {publicDomain}', 'Keep {count} placeholders'],
    };

    const resolved = resolveReservedVariablesDeep(messages, 'en-US', now);

    expect(resolved).toEqual({
      dynamicTitle: {
        base: 'BistuCopilot',
        mixed: 'Start with {appName} on BistuCopilot',
      },
      footer: {
        copyright: '© 2026 AgentifUI',
      },
      list: ['Visit chat.bistu.edu.cn', 'Keep {count} placeholders'],
    });
  });
});
