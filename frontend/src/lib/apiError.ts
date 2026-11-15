// The server answers errors as { error: "message" }. This reads that message from a failed request in a type-safe
// way (no `any`), and falls back to a general message for anything else (network problems, unexpected errors).
import axios from 'axios';

export function apiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError<{ error?: string }>(err)) return err.response?.data?.error || fallback;
  return fallback;
}

/** The machine-readable code some errors carry, e.g. 'EMAIL_NOT_VERIFIED' or 'ACCOUNT_LOCKED' (undefined otherwise). */
export function apiErrorCode(err: unknown): string | undefined {
  return axios.isAxiosError<{ code?: string }>(err) ? err.response?.data?.code : undefined;
}
