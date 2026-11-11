import { google } from 'googleapis';
import { prisma } from './prisma';
import { decrypt } from './crypto';

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Returns an authorized Google client for a user, or null if they have no usable connection.
export async function getGoogleClientForUser(userId: string) {
  const account = await prisma.calendarAccount.findFirst({ where: { userId, provider: 'google' } });
  if (!account) return null;

  const accessToken = decrypt(account.accessToken);
  const refreshToken = decrypt(account.refreshToken);
  if (accessToken === null || refreshToken === null) {
    // Encrypted with a different key (e.g. before ENCRYPTION_KEY was set): the user must reconnect.
    console.warn(`Google tokens for user ${userId} cannot be decrypted; they need to reconnect.`);
    return null;
  }

  const client = createOAuthClient();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return { client, email: account.email };
}
