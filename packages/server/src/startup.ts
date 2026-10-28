export type ServerCommand =
  | { readonly kind: 'start' }
  | { readonly kind: 'help' }
  | { readonly kind: 'api-key' }
  | { readonly kind: 'notify'; readonly args: readonly string[] }
  | { readonly kind: 'usage-error' };

const HELP_FLAGS = ['--help', '-h', 'help'];

/**
 * What `kinoshelf-server` was asked to do. No argument starts the server; anything it does not know
 * is a mistake to report, not a reason to start the server and ignore what was typed.
 */
export function parseServerCommand(argv: readonly string[]): ServerCommand {
  const [first, ...rest] = argv;
  if (first === undefined) {
    return { kind: 'start' };
  }
  if (HELP_FLAGS.includes(first)) {
    return { kind: 'help' };
  }
  if (first === 'api-key') {
    return rest.length === 1 && rest[0] === 'create'
      ? { kind: 'api-key' }
      : { kind: 'usage-error' };
  }
  if (first === 'notify') {
    return rest.some((arg) => HELP_FLAGS.includes(arg))
      ? { kind: 'help' }
      : { kind: 'notify', args: rest };
  }
  return { kind: 'usage-error' };
}

/** The reason the server could not listen, as a code a message can be found for. */
export function describeListenError(
  error: unknown,
  host: string,
  port: number,
):
  | { code: 'server.port-in-use' | 'server.port-denied'; params: { host: string; port: number } }
  | undefined {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'EADDRINUSE') {
    return { code: 'server.port-in-use', params: { host, port } };
  }
  if (code === 'EACCES') {
    return { code: 'server.port-denied', params: { host, port } };
  }
  return undefined;
}
