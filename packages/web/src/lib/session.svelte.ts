import { api, setUnauthorizedHandler } from './api.js';

type Status = 'unknown' | 'signed-in' | 'signed-out';

let status = $state<Status>('unknown');
/** No API key exists yet: the sign-in page offers to create the first one. */
let setup = $state(false);
/** What to type to run the server's commands (`api-key create`): the binary's name varies. */
let command = $state('kinoshelf-server');

// Any request the API refuses for lack of a session sends the user back to the sign-in page.
setUnauthorizedHandler(() => {
  status = 'signed-out';
});

export const session = {
  get status(): Status {
    return status;
  },
  get setup(): boolean {
    return setup;
  },
  get command(): string {
    return command;
  },
  /** The first key was written down: from now on the page asks for it. */
  endSetup(): void {
    setup = false;
  },
  async check(): Promise<void> {
    const state = await api.get<{
      authenticated: boolean;
      setup?: boolean;
      command: string;
    }>('/api/session');
    setup = state.setup ?? false;
    command = state.command;
    status = state.authenticated ? 'signed-in' : 'signed-out';
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
