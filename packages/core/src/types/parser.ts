import type { ParsedMedia } from './media.js';

/**
 * Extracts title, year, season and episode from a file path.
 * Parent folder context is part of the contract: implementations must recognize
 * `Breaking Bad/Season 2/02x05.mkv`.
 */
export interface Parser {
  parse(path: string): ParsedMedia;
}
