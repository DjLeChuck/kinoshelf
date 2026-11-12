/** What `kinoshelf` runs: the CLI, or the server (which also answers `api-key` and `notify`). */
const SERVER_COMMANDS = new Set(['serve', 'api-key', 'notify']);

/**
 * `argv` is what follows the binary. `serve` is the only word the server does not know itself: it
 * starts the server, which takes no argument (see `parseServerCommand`), so it is dropped.
 * Everything else, help and mistakes included, is the CLI's to answer.
 */
export interface Route {
  readonly target: 'server' | 'cli';
  readonly argv: readonly string[];
}

export function route(argv: readonly string[]): Route {
  const [first, ...rest] = argv;
  if (first !== undefined && SERVER_COMMANDS.has(first)) {
    return { target: 'server', argv: first === 'serve' ? rest : argv };
  }
  return { target: 'cli', argv };
}
