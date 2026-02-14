import {
  type BetterAuthUser,
  getCurrentSession,
  getCurrentUser,
  subscribeAuthStateChange,
} from '@lib/auth/better-auth/http-client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from './client';
import type { Database } from './types';

/**
 * Supabase authentication hook.
 * Provides user login status and session information.
 */
export const useSupabaseAuth = () => {
  type LegacySession = {
    user: BetterAuthUser;
    [key: string]: unknown;
  };

  const [user, setUser] = useState<BetterAuthUser | null>(null);
  const [session, setSession] = useState<LegacySession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getSession = async () => {
      setLoading(true);
      const currentSession = await getCurrentSession().catch(() => null);
      const currentUser = currentSession?.user ?? null;
      setSession(currentUser ? { user: currentUser } : null);
      setUser(currentUser);
      setLoading(false);
    };

    void getSession();

    const unsubscribe = subscribeAuthStateChange(() => {
      void getSession();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { user, session, loading };
};

/**
 * User profile hook.
 * Provides user profile information and update method.
 */
export const useProfile = () => {
  const { user } = useSupabaseAuth();
  const supabase = createClient();
  const [profile, setProfile] = useState<
    Database['public']['Tables']['profiles']['Row'] | null
  >(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getProfile = async () => {
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
      } else {
        setProfile(data);
      }

      setLoading(false);
    };

    getProfile();
  }, [user, supabase]);

  const updateProfile = useCallback(
    async (updates: Database['public']['Tables']['profiles']['Update']) => {
      if (!user) return { error: new Error('No user logged in') };

      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();

      if (error) {
        return { error };
      }

      setProfile(data);
      return { data };
    },
    [user, supabase]
  );

  return { profile, loading, updateProfile };
};

/**
 * Organizations hook.
 * Provides information about the organizations the user belongs to.
 */
export const useOrganizations = () => {
  const { user } = useSupabaseAuth();
  const supabase = createClient();
  const [organizations, setOrganizations] = useState<
    Database['public']['Tables']['groups']['Row'][]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getOrganizations = async () => {
      if (!user) {
        setOrganizations([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('groups')
          .select('*')
          .order('name');

        if (error) {
          console.error('Error fetching organizations:', error);
          setOrganizations([]);
        } else {
          setOrganizations(data || []);
        }
      } catch (error) {
        console.error('Error fetching organizations:', error);
        setOrganizations([]);
      }
      setLoading(false);
    };

    getOrganizations();
  }, [user, supabase]);

  return { organizations, loading };
};

/**
 * Conversations hook.
 * Provides the user's conversation list.
 */
export const useConversations = (limit = 10) => {
  const { user } = useSupabaseAuth();
  const supabase = createClient();
  const [conversations, setConversations] = useState<
    Database['public']['Tables']['conversations']['Row'][]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getConversations = async () => {
      if (!user) {
        setConversations([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching conversations:', error);
      } else {
        setConversations(data || []);
      }

      setLoading(false);
    };

    getConversations();
  }, [user, supabase, limit]);

  return { conversations, loading };
};

/**
 * Messages hook.
 * Provides the message list for a specific conversation and a method to send messages.
 */
export const useMessages = (conversationId: string | null) => {
  const supabase = createClient();
  const [messages, setMessages] = useState<
    Database['public']['Tables']['messages']['Row'][]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getMessages = async () => {
      if (!conversationId) {
        setMessages([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
      } else {
        setMessages(data || []);
      }

      setLoading(false);
    };

    getMessages();

    // Set up real-time subscription for new messages
    const subscription = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          setMessages(current => [
            ...current,
            payload.new as Database['public']['Tables']['messages']['Row'],
          ]);
        }
      )
      .subscribe();

    getMessages();

    return () => {
      subscription.unsubscribe();
    };
  }, [conversationId, supabase]);

  const sendMessage = useCallback(
    async (content: string, role: 'user' | 'system' = 'user') => {
      if (!conversationId)
        return { error: new Error('No conversation selected') };

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role,
          content,
          user_id: role === 'user' ? (await getCurrentUser())?.id : null,
        })
        .select()
        .single();

      return { data, error };
    },
    [conversationId, supabase]
  );

  return { messages, loading, sendMessage };
};
