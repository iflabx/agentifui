/**
 * Compatibility shim.
 * Legacy callers should migrate to `useAuthSession` from better-auth.
 */
export { useAuthSession as useSupabaseAuth } from '@lib/auth/better-auth/react-hooks';
