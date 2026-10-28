import { api, setUnauthorizedHandler } from './api.js';

type Status = 'unknown' | 'signed-in' | 'signed-out';

let status = $state<Status>('unknown');

// Any request the API refuses for lack of a session sends the user back to the sign-in page.
setUnauthorizedHandler(() => {
  status = 'signed-out';
});

export const session = {
  get status(): Status {
    return status;
  },
  async check(): Promise<void> {
    const { authenticated } = await api.get<{ authenticated: boolean }>('/api/session');
    status = authenticated ? 'signed-in' : 'signed-out';
  },
  async signIn(apiKey: string): Promise<void> {
    await api.post('/api/session', { apiKey });
    status = 'signed-in';
  },
  async signOut(): Promise<void> {
    await api.delete('/api/session');
    status = 'signed-out';
  },
};
