import {
  session, authLoading, authError, identitySession, cloudWakeState, handleLogin, handleRegister, handleLogout, retryAuth,
} from '@/services/auth';

export function useAuth() {
  return { session, authLoading, authError, identitySession, cloudWakeState, handleLogin, handleRegister, handleLogout, retryAuth };
}
