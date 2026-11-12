import { isSea } from 'node:sea';

/**
 * What to type to reach the server's commands (`api-key create`, `notify`): the standalone binary
 * has one `kinoshelf` for everything, while a checkout or the Docker image has `kinoshelf-server`.
 */
export const serverCommand = (): string => (isSea() ? 'kinoshelf' : 'kinoshelf-server');

/** The command that starts the server, as the help names it. */
export const serverUsage = (): string => (isSea() ? 'kinoshelf serve' : 'kinoshelf-server');
