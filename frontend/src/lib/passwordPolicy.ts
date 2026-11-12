// The password rules set by administrators, loaded from the server for the sign-up and reset forms.
import { useEffect, useState } from 'react';
import axios from 'axios';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  checkBreached: boolean;
}

const FALLBACK: PasswordPolicy = {
  minLength: 8, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSymbol: true, checkBreached: true,
};

export function usePasswordPolicy() {
  const [policy, setPolicy] = useState<PasswordPolicy>(FALLBACK);
  useEffect(() => {
    axios.get('/api/auth/password-policy').then(r => setPolicy(r.data)).catch(() => { /* keep the strict fallback */ });
  }, []);
  return policy;
}

/** "At least 10 characters, with an uppercase letter, a number and a special character." */
export function describePolicy(p: PasswordPolicy) {
  const parts = [
    p.requireUppercase && 'an uppercase letter',
    p.requireLowercase && 'a lowercase letter',
    p.requireNumber && 'a number',
    p.requireSymbol && 'a special character',
  ].filter(Boolean) as string[];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `At least ${p.minLength} characters${list ? `, with ${list}` : ''}.`;
}

/** Returns an error message if the password breaks the policy (the server checks again). */
export function checkPassword(p: PasswordPolicy, pw: string): string | null {
  const ok = pw.length >= p.minLength
    && (!p.requireUppercase || /[A-Z]/.test(pw))
    && (!p.requireLowercase || /[a-z]/.test(pw))
    && (!p.requireNumber || /[0-9]/.test(pw))
    && (!p.requireSymbol || /[^A-Za-z0-9]/.test(pw));
  return ok ? null : `Password does not meet the rules: ${describePolicy(p)}`;
}
