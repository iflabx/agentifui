/**
 * Hook to combine database conversations and temporary (pending) conversations.
 *
 * This hook merges conversations from two sources:
 * 1. Official conversations from the database (via useSidebarConversations)
 * 2. Temporary conversations from the frontend store (via usePendingConversationStore)
 *
 */
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import {
  PendingConversation,
  usePendingConversationStore,
} from '@lib/stores/pending-conversation-store';
import { Conversation } from '@lib/types/database';

import { useEffect, useMemo, useState } from 'react';

import { useSidebarConversations } from './use-sidebar-conversations';

// Extend Conversation type to add temporary state flags
// user_id can be undefined to support anonymous users' temporary conversations and be compatible with Partial<Conversation>
export interface CombinedConversation extends Partial<Conversation> {
  id: string; // required field
  title: string; // required field
  user_id?: string; // optional string, i.e., string | undefined
  created_at: string; // required field
  updated_at: string; // required field
  isPending?: boolean; // whether this is a temporary conversation
  pendingStatus?: PendingConversation['status']; // status of the temporary conversation
  tempId?: string; // temporary ID
  db_pk?: string; // database primary key

  // Typewriter effect state for the title
  titleTypewriterState?: {
    isTyping: boolean; // whether the typewriter effect is active
    targetTitle: string; // the full target title
    displayTitle: string; // the currently displayed (possibly partial) title
    shouldStartTyping: boolean; // whether the typewriter effect should start
  };
}

/**
 * Hook to combine database and temporary conversations.
 *
 * @returns The combined conversation list, loading state, error, and refresh function.
 */
export function useCombinedConversations() {
  // Fetch 20 database conversations to allow for overflow when new conversations are created, triggering the "eviction" logic
  const {
    conversations: dbConversations,
    isLoading: isDbLoading,
    error: dbError,
    refresh: refreshDbConversations,
  } = useSidebarConversations(20);

  // Get the current logged-in user ID
  const { session } = useAuthSession();
  const currentUserId = session?.user?.id;

  // Get the temporary conversation list
  // Use useEffect to listen for changes in the pendingConversationStore
  const pendingConversations = usePendingConversationStore(
    state => state.pendingConversations
  );
  const [pendingArray, setPendingArray] = useState<PendingConversation[]>([]);

  // Listen for changes in pendingConversations and update pendingArray accordingly
  useEffect(() => {
    setPendingArray(Array.from(pendingConversations.values()));
  }, [pendingConversations]);

  // Store the previous combined conversation list to avoid flicker when switching routes
  const [prevCombinedConversations, setPrevCombinedConversations] = useState<
    CombinedConversation[]
  >([]);

  // Combine database and temporary conversations
  const combinedConversations = useMemo(() => {
    const finalConversations: CombinedConversation[] = [];
    const dbConvsRealIds = new Set<string>();

    // If both database and temporary conversations are empty, but there is a previous combined list, return the previous list to avoid sidebar flicker
    if (
      dbConversations.length === 0 &&
      pendingArray.length === 0 &&
      prevCombinedConversations.length > 0
    ) {
      console.log(
        '[useCombinedConversations] Both database and temporary conversations are empty, using previous combined conversation list'
      );
      return prevCombinedConversations;
    }

    // 1. Process database conversations
    dbConversations.forEach(dbConv => {
      const realId = dbConv.external_id || dbConv.id; // Prefer external_id as the realId
      if (realId) {
        dbConvsRealIds.add(realId);
      }
      finalConversations.push({
        ...dbConv,
        id: realId, // Use realId as the primary ID for CombinedConversation
        db_pk: dbConv.id, // Store database PK
        isPending: false,
        pendingStatus: undefined,
        tempId: undefined,
      });
    });

    // 2. Process and add temporary conversations not already covered by the database version
    pendingArray.forEach(pending => {
      // If the temporary conversation has a realId and it's already covered by dbConversations, skip it.
      if (pending.realId && dbConvsRealIds.has(pending.realId)) {
        return;
      }

      finalConversations.push({
        // Inherited from Partial<Conversation> - provide defaults or map from pending
        ai_config_id: null,
        summary: null,
        settings: {},
        status: 'active', // Or map from pending.status if needed for display
        external_id: pending.realId || null, // This is the Dify ID
        app_id: null, // @future: consider if temporary conversations need app_id context
        last_message_preview: pending.title.substring(0, 50), // Example preview
        metadata: {}, // @future: consider if temporary conversations can have metadata

        // Required CombinedConversation fields
        id: pending.realId || pending.tempId, // Primary ID: Dify realId if available, else tempId
        title: pending.title,
        user_id: currentUserId || undefined,
        created_at: pending.createdAt, // Use timestamp from pending store
        updated_at: pending.updatedAt, // Use timestamp from pending store

        // Pending specific fields
        isPending: true,
        pendingStatus: pending.status,
        tempId: pending.tempId,
        db_pk: pending.db_pk, // Use db_pk from pending store if available

        // Map typewriter effect state
        titleTypewriterState: pending.titleTypewriterState,
      });
    });

    // 3. Sort conversations
    finalConversations.sort((a, b) => {
      // Example: active pending items first, then by updated_at
      if (
        a.isPending &&
        a.pendingStatus &&
        ['creating', 'streaming_message', 'title_fetching'].includes(
          a.pendingStatus
        ) &&
        !(
          b.isPending &&
          b.pendingStatus &&
          ['creating', 'streaming_message', 'title_fetching'].includes(
            b.pendingStatus
          )
        )
      ) {
        return -1;
      }
      if (
        !(
          a.isPending &&
          a.pendingStatus &&
          ['creating', 'streaming_message', 'title_fetching'].includes(
            a.pendingStatus
          )
        ) &&
        b.isPending &&
        b.pendingStatus &&
        ['creating', 'streaming_message', 'title_fetching'].includes(
          b.pendingStatus
        )
      ) {
        return 1;
      }
      // Fallback to updated_at, ensuring it's a valid date string
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return dateB - dateA;
    });

    // Limit the total number of conversations to 20 to implement the "eviction" effect.
    // When new temporary conversations are added, automatically remove the oldest ones exceeding the limit.
    const MAX_CONVERSATIONS = 20;
    if (finalConversations.length > MAX_CONVERSATIONS) {
      // Keep the first 20 conversations (including active temporary ones)
      const keptConversations = finalConversations.slice(0, MAX_CONVERSATIONS);
      const evictedConversations = finalConversations.slice(MAX_CONVERSATIONS);

      console.log(
        `[useCombinedConversations] Eviction triggered, keeping ${keptConversations.length} conversations, removing ${evictedConversations.length} conversations`
      );
      evictedConversations.forEach(conv => {
        console.log(
          `[useCombinedConversations] Evicted conversation: ${conv.title} (${conv.id})`
        );
      });

      return keptConversations;
    }

    return finalConversations;
  }, [dbConversations, pendingArray, currentUserId]);

  // Refresh function
  const refresh = () => {
    refreshDbConversations();
    // Force refresh pendingArray
    setPendingArray(Array.from(pendingConversations.values()));
    // Emit global refresh event to notify other components that data has been updated
    conversationEvents.emit();
  };

  // Listen for global refresh events
  useEffect(() => {
    const unsubscribe = conversationEvents.subscribe(() => {
      refreshDbConversations();
      setPendingArray(Array.from(pendingConversations.values()));
    });

    return () => {
      unsubscribe();
    };
  }, [refreshDbConversations, pendingConversations]);

  // Enhanced: Safe cleanup mechanism for temporary conversations.
  // Add a time buffer and stricter cleanup conditions to ensure pending conversations are not accidentally removed.
  // Only clean up temporary conversations that meet ALL of the following:
  // 1. Existed for more than 15 minutes (buffer to ensure all operations are complete)
  // 2. Have a corresponding database record
  // 3. Status is completed (persisted_optimistic or title_resolved)
  // 4. Must have a database primary key (ensure truly saved to DB)
  // 5. Title must be finalized
  useEffect(() => {
    const dbRealIds = new Set(dbConversations.map(c => c.external_id || c.id));
    const { removePending } = usePendingConversationStore.getState();

    const cleanupExpiredPendingConversations = () => {
      const now = Date.now();

      pendingArray.forEach(p => {
        // Check conversation age
        const createdTime = new Date(p.createdAt).getTime();
        const ageInMinutes = (now - createdTime) / (1000 * 60);

        // Stricter cleanup conditions to avoid race conditions
        const shouldCleanup =
          // Basic condition: more than 15 minutes old (buffer)
          ageInMinutes > 15 &&
          // Must have a realId
          p.realId &&
          // Database contains corresponding record
          dbRealIds.has(p.realId) &&
          // Status must be completed
          (p.status === 'persisted_optimistic' ||
            p.status === 'title_resolved') &&
          // Must have database primary key
          p.db_pk &&
          // Title must be finalized
          p.isTitleFinal;

        if (shouldCleanup) {
          console.log(
            `[useCombinedConversations] Cleaning up confirmed saved temporary conversation: ${p.tempId} (realId: ${p.realId}, age: ${ageInMinutes.toFixed(1)} min)`
          );
          removePending(p.tempId);
        } else if (p.realId && dbRealIds.has(p.realId)) {
          // Log reasons for keeping, for debugging
          const reasons = [];
          if (ageInMinutes <= 15)
            reasons.push(`Not old enough (${ageInMinutes.toFixed(1)} min)`);
          if (
            p.status !== 'persisted_optimistic' &&
            p.status !== 'title_resolved'
          )
            reasons.push(`Status not completed (${p.status})`);
          if (!p.db_pk) reasons.push('No database primary key');
          if (!p.isTitleFinal) reasons.push('Title not finalized');

          if (reasons.length > 0 && ageInMinutes > 5) {
            // Only log for conversations older than 5 minutes
            console.log(
              `[useCombinedConversations] Keeping temporary conversation ${p.tempId}: ${reasons.join(', ')}`
            );
          }
        }
      });
    };

    // Delay first execution to avoid accidental deletion on initialization
    const initialDelay = setTimeout(cleanupExpiredPendingConversations, 30000); // 30 seconds

    // Check every 3 minutes (lower frequency to reduce race risk)
    const intervalId = setInterval(
      cleanupExpiredPendingConversations,
      3 * 60 * 1000
    );

    // Cleanup timers on unmount
    return () => {
      clearTimeout(initialDelay);
      clearInterval(intervalId);
    };
  }, [dbConversations, pendingArray]);

  // When the combined conversation list updates, save the current state for sidebar stability during route changes
  useEffect(() => {
    if (combinedConversations.length > 0) {
      setPrevCombinedConversations(combinedConversations);
    }
  }, [combinedConversations]);

  return {
    conversations: combinedConversations,
    isLoading: isDbLoading,
    error: dbError,
    refresh,
  };
}

// Global event system for synchronizing conversation data updates
class ConversationEventEmitter {
  private listeners: Set<() => void> = new Set();

  subscribe(callback: () => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit() {
    this.listeners.forEach(callback => callback());
  }
}

export const conversationEvents = new ConversationEventEmitter();
