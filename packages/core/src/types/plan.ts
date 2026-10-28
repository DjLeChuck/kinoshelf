import type { ErrorInfo } from './errors.js';
import type { ExternalId, ParsedMedia } from './media.js';
import type { Operation, OperationResult, TransferMode } from './operation.js';

/** In v0.1 the only resolution is to skip the item; the destination is never overwritten. */
export type ConflictReason =
  /** A file already exists at the destination: never overwritten by default. */
  | 'destination-exists'
  /** Two source files target the same destination within the batch. */
  | 'duplicate-destination'
  /**
   * Hardlink mode, but source and destination are on different filesystems. There is no
   * automatic fallback: the user must change the configuration or pick copy/move.
   */
  | 'hardlink-cross-device'
  /** The target name cannot be built (missing year, no episode number, unsafe segment…). */
  | 'unresolvable-name';

export interface Conflict {
  readonly reason: ConflictReason;
  /** The path concerned (for `unresolvable-name`: the source file). */
  readonly path: string;
  /** Why, when the reason alone is not enough (e.g. which template variable is missing). */
  readonly detail?: ErrorInfo;
}

/**
 * - `ready`: operations will be executed.
 * - `in-place`: source already is at the target location (already compliant): nothing to do,
 *   not a conflict.
 * - `conflict`: not executed, goes to the validation queue; `conflicts` is non-empty.
 */
export type PlanItemStatus = 'ready' | 'in-place' | 'conflict';

/** What is planned for one source file. */
export interface PlanItem {
  readonly id: string;
  readonly status: PlanItemStatus;
  readonly parsed: ParsedMedia;
  readonly externalId: ExternalId;
  readonly operations: readonly Operation[];
  /**
   * Non-empty iff `status` is `conflict`. A conflict on a sidecar alone does not block the item:
   * the sidecar operation is skipped with a warning instead.
   */
  readonly conflicts: readonly Conflict[];
}

export interface Plan {
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
  readonly profileId: string;
  /** Absolute root every destination lives under. */
  readonly destinationRoot: string;
  readonly mode: TransferMode;
  readonly items: readonly PlanItem[];
}

export interface ItemResult {
  readonly itemId: string;
  readonly results: readonly OperationResult[];
}

export interface BatchResult {
  readonly batchId: string;
  readonly planId: string;
  /** `true`: nothing was written, `items` lists what would have been done. */
  readonly dryRun: boolean;
  readonly items: readonly ItemResult[];
}
