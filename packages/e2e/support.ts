import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Everything the stack writes lives here; `stack.mjs` empties it at each start. */
export const DIR = process.env.E2E_DIR ?? join(tmpdir(), 'kinoshelf-e2e');
export const PORT = 8587;
export const TMDB_PORT = 8588;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** At least 32 characters, as the server demands. */
export const API_KEY = 'e2e-api-key-0123456789-0123456789';

export const incoming = (...parts: string[]): string => join(DIR, 'incoming', ...parts);
export const library = (...parts: string[]): string => join(DIR, 'library', ...parts);
