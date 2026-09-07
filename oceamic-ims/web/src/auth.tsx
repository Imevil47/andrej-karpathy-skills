import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiGet, apiPost } from './api';

export type Permission = string;

export type CurrentUser = Readonly<{
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'QUALITE' | 'STOCK' | 'PRODUCTION' | 'LECTURE';
}>;

type Session = Readonly<{ user: CurrentUser; permissions: readonly Permission[] }>;

type AuthState = Readonly<{
  session: Session | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
}>;

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Session>('/api/auth/me')
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    setSession(await apiPost<Session>('/api/auth/login', { username, password }));
  }, []);

  const signOut = useCallback(async () => {
    await apiPost('/api/auth/logout', {});
    setSession(null);
  }, []);

  const can = useCallback(
    (permission: Permission) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  const value = useMemo<AuthState>(
    () => ({ session, loading, signIn, signOut, can }),
    [session, loading, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé à l'intérieur de AuthProvider.");
  }
  return context;
}
