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
    const syncSession = async () => {
      setLoading(true);
      const currentSession = await getCurrentSession().catch(() => null);
      const currentUser = currentSession?.user ?? null;
      setSession(currentUser ? { user: currentUser } : null);
      setUser(currentUser);
      setLoading(false);
    };

    void syncSession();
    const unsubscribe = subscribeAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { user, session, loading };
}
