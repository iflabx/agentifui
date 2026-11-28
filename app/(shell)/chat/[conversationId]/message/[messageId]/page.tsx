'use client';

import { HistoryMessageView } from '@components/history/history-message';

import { useParams } from 'next/navigation';

export default function HistoryMessagePage() {
  const { conversationId, messageId } = useParams<{
    conversationId: string;
    messageId: string;
  }>();
  return (
    <HistoryMessageView conversationId={conversationId} messageId={messageId} />
  );
}
