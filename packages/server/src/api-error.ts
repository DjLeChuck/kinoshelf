/** A failure the client caused or can fix; the HTTP layer turns it into `{ error: { code } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
