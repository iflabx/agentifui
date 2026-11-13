'use client';

import { AgentChat } from '@components/langchain/agent-chat';

import { useParams, useSearchParams } from 'next/navigation';

export default function LangChainAppPage() {
  const params = useParams();
  const query = useSearchParams();
  const appId = typeof params?.appId === 'string' ? params.appId : '';
  return (
    <AgentChat
      key={appId}
      appId={appId}
      conversationId={query?.get('conversationId') ?? null}
    />
  );
}
