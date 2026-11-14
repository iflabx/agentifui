import { useEffect, useState } from 'react';

import {
  type BetterAuthUser,
  getCurrentSession,
  subscribeAuthStateChange,
} from './http-client';

type AuthSession = {
  user: BetterAuthUser;
  [key: string]: unknown;
} | null;

export function useAuthSession() {
  const [user, setUser] = useState<BetterAuthUser | null>(null);
  const [session, setSession] = useState<AuthSession>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let generation = 0;
    let mounted = true;
    const syncSession = async () => {
      const version = ++generation;
      setLoading(true);
      try {
        const currentSession = await getCurrentSession();
        if (!mounted || version !== generation) return;
        const currentUser = currentSession?.user ?? null;
        setSession(currentUser ? { user: currentUser } : null);
        setUser(currentUser);
      } catch {
        return;
      } finally {
        if (mounted && version === generation) setLoading(false);
      }
    };

    void syncSession();
    const unsubscribe = subscribeAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { user, session, loading };
}
