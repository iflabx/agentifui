/**
 * @jest-environment node
 */
import { dataService } from '@lib/services/db/data-service';
import type {
  Conversation,
  Message,
  Profile,
  Provider,
  ServiceInstance,
} from '@lib/types/database';
import type { Result } from '@lib/types/result';
import { randomUUID } from 'crypto';

const FALLBACK_DATABASE_URL =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui';
const PG_POOL_GLOBAL_KEY = '__agentifui_pg_pool__';

type PoolLike = {
  end: () => Promise<void>;
};

function expectSuccess<T>(result: Result<T>, action: string): T {
  if (!result.success) {
    throw new Error(
      `${action} failed: ${result.error?.message || 'unknown database error'}`
    );
  }

  return result.data;
}

async function cleanupRecord(table: string, id: string | null) {
  if (!id) {
    return;
  }

  await dataService.delete(table, id);
}

describe('M3 managed CRUD compatibility', () => {
  beforeAll(() => {
    process.env.DATABASE_URL ||= FALLBACK_DATABASE_URL;
  });

  afterAll(async () => {
    dataService.destroy();

    const globalState = globalThis as unknown as Record<string, unknown>;
    const pool = globalState[PG_POOL_GLOBAL_KEY] as PoolLike | undefined;
    if (!pool) {
      return;
    }

    await pool.end();
    delete globalState[PG_POOL_GLOBAL_KEY];
  });

  it('supports managed-table CRUD through DataService', async () => {
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const profileId = randomUUID();

    let providerId: string | null = null;
    let serviceInstanceId: string | null = null;
    let conversationId: string | null = null;
    let messageId: string | null = null;
    let profileCreated = false;

    try {
      const provider = expectSuccess(
        await dataService.create<Provider>('providers', {
          name: `m3-provider-${suffix}`,
          type: 'llm',
          base_url: 'https://example.invalid/api',
          auth_type: 'bearer',
          is_active: true,
          is_default: false,
        }),
        'create provider'
      );
      providerId = provider.id;

      const providerLookup = expectSuccess(
        await dataService.findOne<Provider>('providers', { id: providerId }),
        'find provider by id'
      );
      expect(providerLookup?.name).toBe(provider.name);

      const serviceInstance = expectSuccess(
        await dataService.create<ServiceInstance>('service_instances', {
          provider_id: providerId,
          instance_id: `m3-instance-${suffix}`,
          api_path: '/v1/chat',
          display_name: 'M3 Instance',
          description: 'integration test instance',
          is_default: false,
          visibility: 'public',
          config: { model: 'gpt-4.1-mini', source: 'm3-test' },
        }),
        'create service instance'
      );
      serviceInstanceId = serviceInstance.id;

      const profile = expectSuccess(
        await dataService.create<Profile>('profiles', {
          id: profileId,
          email: `m3-${suffix}@example.com`,
          username: `m3_${suffix}`,
          auth_source: 'native',
          role: 'user',
          status: 'active',
        }),
        'create profile'
      );
      profileCreated = true;
      expect(profile.id).toBe(profileId);

      const updatedProfile = expectSuccess(
        await dataService.update<Profile>('profiles', profileId, {
          full_name: 'M3 Migration Tester',
        }),
        'update profile'
      );
      expect(updatedProfile.full_name).toBe('M3 Migration Tester');

      const conversation = expectSuccess(
        await dataService.create<Conversation>('conversations', {
          user_id: profileId,
          ai_config_id: null,
          title: 'M3 Conversation',
          summary: null,
          settings: { language: 'zh-CN' },
          metadata: { source: 'm3' },
          status: 'active',
          external_id: `ext-${suffix}`,
          app_id: 'chat-app',
          last_message_preview: null,
        }),
        'create conversation'
      );
      conversationId = conversation.id;

      const message = expectSuccess(
        await dataService.create<Message>('messages', {
          conversation_id: conversationId,
          user_id: profileId,
          role: 'user',
          content: 'hello from m3 verify',
          metadata: { round: 1 },
          status: 'sent',
          external_id: null,
          token_count: 8,
          is_synced: true,
          sequence_index: 0,
        }),
        'create message'
      );
      messageId = message.id;

      const messageList = expectSuccess(
        await dataService.findMany<Message>(
          'messages',
          { conversation_id: conversationId },
          { column: 'created_at', ascending: true }
        ),
        'find messages by conversation id'
      );
      expect(messageList.length).toBeGreaterThanOrEqual(1);
      expect(messageList[0]?.conversation_id).toBe(conversationId);

      const messageCount = expectSuccess(
        await dataService.count('messages', {
          conversation_id: conversationId,
        }),
        'count messages by conversation id'
      );
      expect(messageCount).toBeGreaterThanOrEqual(1);

      const updatedMessage = expectSuccess(
        await dataService.update<Message>('messages', messageId, {
          status: 'delivered',
        }),
        'update message status'
      );
      expect(updatedMessage.status).toBe('delivered');

      const updatedConversation = expectSuccess(
        await dataService.update<Conversation>(
          'conversations',
          conversationId,
          {
            metadata: { source: 'm3', checked: true },
            last_message_preview: 'hello from m3 verify',
          }
        ),
        'update conversation metadata'
      );
      expect(updatedConversation.metadata?.checked).toBe(true);
    } finally {
      await cleanupRecord('messages', messageId);
      await cleanupRecord('conversations', conversationId);
      await cleanupRecord('service_instances', serviceInstanceId);
      await cleanupRecord('providers', providerId);
      await cleanupRecord('profiles', profileCreated ? profileId : null);
    }
  });
});
