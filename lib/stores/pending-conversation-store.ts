import { create } from 'zustand';

// Define the structure and state for a pending conversation
export interface PendingConversation {
  tempId: string; // Client-generated temporary ID
  realId?: string; // Real conversation ID from backend
  status:
    | 'creating'
    | 'title_fetching'
    | 'streaming_message'
    | 'stream_completed_title_pending'
    | 'title_resolved'
    | 'persisted_optimistic'
    | 'failed'; // Conversation status
  title: string; // Current displayed title (could be "Creating...", "New conversation...", "Untitled", or the real title)
  isTitleFinal: boolean; // Whether the title is finalized (from /name API)
  createdAt: string; // Creation time
  updatedAt: string; // Last update time
  db_pk?: string; // Database primary key, used when stored in DB but still pending

  // Typewriter effect state
  titleTypewriterState?: {
    isTyping: boolean; // Whether the typewriter effect is active
    targetTitle: string; // The full target title
    displayTitle: string; // The currently displayed (possibly partial) title
    shouldStartTyping: boolean; // Whether the typewriter effect should start
  };
}

// Define the store state interface
interface PendingConversationState {
  // Use a Map to store pending conversations for efficient lookup and update by tempId or realId
  // Key is tempId, value is the PendingConversation object
  pendingConversations: Map<string, PendingConversation>;

  // Actions
  addPending: (tempId: string, initialTitle?: string) => void;
  // Add a pending conversation with a limit, supporting "eviction" of the oldest when exceeding max
  addPendingWithLimit: (
    tempId: string,
    initialTitle?: string,
    maxConversations?: number,
    onNeedEviction?: (evictedCount: number) => void
  ) => void;
  setRealIdAndStatus: (
    tempId: string,
    realId: string,
    status: PendingConversation['status']
  ) => void;
  updateStatus: (id: string, status: PendingConversation['status']) => void; // id can be tempId or realId
  updateTitle: (id: string, title: string, isFinal: boolean) => void; // Update title and set if it's final
  removePending: (id: string) => void; // id can be tempId or realId
  markAsOptimistic: (id: string) => void; // Mark conversation as optimistically persisted
  setDatabasePK: (id: string, dbPK: string) => void; // Set database PK for a pending conversation stored in DB

  // Typewriter effect actions
  startTitleTypewriter: (id: string, targetTitle: string) => void; // Start typewriter effect for title
  updateTypewriterDisplay: (id: string, displayTitle: string) => void; // Update the displayed title during typewriter effect
  completeTitleTypewriter: (id: string) => void; // Complete the typewriter effect

  // Atomic state update to avoid race conditions
  markAsPersistedComplete: (
    id: string,
    dbPK: string,
    finalTitle?: string
  ) => void; // Atomically mark as fully persisted

  // Selectors / Getters (optional but recommended for safe access outside the store)
  getPendingByTempId: (tempId: string) => PendingConversation | undefined;
  getPendingByRealId: (realId: string) => PendingConversation | undefined;
}

// Create Zustand store
export const usePendingConversationStore = create<PendingConversationState>(
  (set, get) => ({
    pendingConversations: new Map(),

    addPending: (tempId, initialTitle = 'Creating...') => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        if (newMap.has(tempId)) {
          console.warn(
            `[PendingConversationStore] Attempted to add an existing tempId: ${tempId}`
          );
          return state;
        }
        newMap.set(tempId, {
          tempId,
          status: 'creating', // Initial status is 'creating'
          title: initialTitle,
          isTitleFinal: false, // Initial title is not final
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return { pendingConversations: newMap };
      });
    },

    setRealIdAndStatus: (
      tempId: string,
      realId: string,
      status: PendingConversation['status']
    ) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        const entry = newMap.get(tempId);
        if (entry) {
          newMap.set(tempId, {
            ...entry,
            realId,
            status,
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        console.warn(`[PendingConversationStore] tempId not found: ${tempId}`);
        return state;
      });
    },

    updateTitle: (id: string, title: string, isFinal: boolean) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey) {
          // Update title and isTitleFinal
          // If isFinal is true and current status is 'title_fetching', also update status to 'title_resolved'
          const newStatus =
            isFinal && entry.status === 'title_fetching'
              ? 'title_resolved'
              : entry.status;
          newMap.set(entryKey, {
            ...entry,
            title,
            isTitleFinal: isFinal,
            status: newStatus,
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        console.warn(`[PendingConversationStore] ID not found: ${id}`);
        return state;
      });
    },

    updateStatus: (id: string, status: PendingConversation['status']) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey) {
          newMap.set(entryKey, {
            ...entry,
            status,
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        console.warn(`[PendingConversationStore] ID not found: ${id}`);
        return state;
      });
    },

    removePending: (id: string) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let keyToDelete: string | undefined = id;

        if (!newMap.has(id)) {
          // If id is not a tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              keyToDelete = key; // Found the corresponding tempId
              break;
            }
          }
        }

        if (keyToDelete && newMap.has(keyToDelete)) {
          newMap.delete(keyToDelete);
          return { pendingConversations: newMap };
        }
        console.warn(
          `[PendingConversationStore] ID to delete not found: ${id}`
        );
        return state;
      });
    },

    getPendingByTempId: tempId => {
      return get().pendingConversations.get(tempId);
    },

    getPendingByRealId: realId => {
      for (const conversation of get().pendingConversations.values()) {
        if (conversation.realId === realId) {
          return conversation;
        }
      }
      return undefined;
    },

    markAsOptimistic: (id: string) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey) {
          // Ensure the conversation has a realId before marking as optimistic
          if (entry.realId) {
            newMap.set(entryKey, {
              ...entry,
              status: 'persisted_optimistic',
              updatedAt: new Date().toISOString(),
            });
            // console.log(`[PendingConversationStore] Marked ${entryKey} (realId: ${entry.realId}) as persisted_optimistic`);
            return { pendingConversations: newMap };
          } else {
            console.warn(
              `[PendingConversationStore] Cannot mark ${entryKey} as persisted_optimistic without a realId.`
            );
            return state;
          }
        }
        console.warn(
          `[PendingConversationStore] markAsOptimistic: ID not found: ${id}`
        );
        return state;
      });
    },

    setDatabasePK: (id: string, dbPK: string) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey) {
          newMap.set(entryKey, {
            ...entry,
            db_pk: dbPK,
            updatedAt: new Date().toISOString(),
          });
          // console.log(`[PendingConversationStore] Set db_pk for ${entryKey} (realId: ${entry.realId}) to ${dbPK}`);
          return { pendingConversations: newMap };
        }
        console.warn(
          `[PendingConversationStore] setDatabasePK: ID not found: ${id}`
        );
        return state;
      });
    },

    // Typewriter effect actions
    startTitleTypewriter: (id: string, targetTitle: string) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey) {
          newMap.set(entryKey, {
            ...entry,
            titleTypewriterState: {
              isTyping: true,
              targetTitle,
              displayTitle: entry.title, // Start from current title
              shouldStartTyping: true,
            },
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        console.warn(
          `[PendingConversationStore] startTitleTypewriter: ID not found: ${id}`
        );
        return state;
      });
    },

    updateTypewriterDisplay: (id: string, displayTitle: string) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey && entry.titleTypewriterState) {
          newMap.set(entryKey, {
            ...entry,
            titleTypewriterState: {
              ...entry.titleTypewriterState,
              displayTitle,
              shouldStartTyping: false, // Already started typing, do not trigger again
            },
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        return state;
      });
    },

    completeTitleTypewriter: (id: string) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey && entry.titleTypewriterState) {
          const finalTitle = entry.titleTypewriterState.targetTitle;
          newMap.set(entryKey, {
            ...entry,
            title: finalTitle, // Update to final title
            titleTypewriterState: {
              ...entry.titleTypewriterState,
              isTyping: false,
              displayTitle: finalTitle,
              shouldStartTyping: false,
            },
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        return state;
      });
    },

    // Add a pending conversation with a limit, supporting "eviction" of the oldest when exceeding max
    addPendingWithLimit: (
      tempId: string,
      initialTitle = 'Creating...',
      _maxConversations = 20,
      onNeedEviction
    ) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);

        if (newMap.has(tempId)) {
          console.warn(
            `[PendingConversationStore] Attempted to add an existing tempId: ${tempId}`
          );
          return state;
        }

        // Create a new pending conversation
        const newPending: PendingConversation = {
          tempId,
          title: initialTitle,
          status: 'creating',
          isTitleFinal: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Initialize typewriter effect state
          titleTypewriterState: {
            isTyping: false,
            targetTitle: initialTitle,
            displayTitle: initialTitle,
            shouldStartTyping: false,
          },
        };

        // Add the new conversation
        newMap.set(tempId, newPending);

        // Note: This store only manages pending conversations.
        // The actual "eviction" logic should be handled in the combined data layer (e.g., useCombinedConversations).
        // Here, just notify the callback so the upper layer can decide how to handle it.
        if (onNeedEviction && typeof onNeedEviction === 'function') {
          // Calculate the current number of pending conversations, and notify if exceeding the limit
          const pendingCount = newMap.size;
          if (pendingCount > 1) {
            // New conversation already added, check if eviction is needed
            onNeedEviction(1); // Simply notify that 1 conversation needs to be evicted
          }
        }

        return { pendingConversations: newMap };
      });
    },

    // Atomically mark as fully persisted, avoiding race conditions
    markAsPersistedComplete: (
      id: string,
      dbPK: string,
      finalTitle?: string
    ) => {
      set(state => {
        const newMap = new Map(state.pendingConversations);
        let entryKey: string | undefined = id;
        let entry = newMap.get(id); // Try to find by tempId

        if (!entry) {
          // If not found by tempId, try to find by realId
          for (const [key, value] of newMap.entries()) {
            if (value.realId === id) {
              entry = value;
              entryKey = key;
              break;
            }
          }
        }

        if (entry && entryKey) {
          newMap.set(entryKey, {
            ...entry,
            status: 'title_resolved',
            isTitleFinal: true,
            title: finalTitle || entry.title,
            db_pk: dbPK,
            updatedAt: new Date().toISOString(),
          });
          return { pendingConversations: newMap };
        }
        console.warn(
          `[PendingConversationStore] markAsPersistedComplete: ID not found: ${id}`
        );
        return state;
      });
    },
  })
);

// You can add some helper selectors here if needed
// For example: selectIsAnyPending, selectPendingTitles, etc.
