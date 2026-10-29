export type * from './types/media.js';
export type * from './types/parser.js';
export type * from './types/provider.js';
export type * from './types/matching.js';
export type * from './types/profile.js';
export type * from './types/operation.js';
export type * from './types/plan.js';
export type * from './types/journal.js';
export type * from './types/errors.js';
export { ERROR_CODES, type ErrorCode } from './error-codes.js';
export { KinoshelfError } from './errors.js';
export {
  listBundledProfiles,
  loadProfile,
  loadBundledProfile,
  loadProfileFile,
  parseProfile,
} from './profiles/loader.js';
export {
  parseTemplate,
  renderTemplate,
  templateVariables,
  type ParsedTemplate,
  type RenderContext,
  type TemplateValue,
  type TemplateVariables,
} from './profiles/template.js';
export { GuessitParser, type GuessitParserOptions } from './parsing/guessit-parser.js';
export {
  DEFAULT_MATCHING_CONFIG,
  type MatchingConfig,
  type ScoreWeights,
} from './matching/config.js';
export { Matcher } from './matching/matcher.js';
export {
  aliasKey,
  StaticAliases,
  type AliasLookup,
  type AliasQuery,
  type TitleAlias,
} from './matching/aliases.js';
export { normalizeTitle, titleSimilarity } from './matching/title-similarity.js';
export { createPlan, type PlanInput, type PlannerOptions } from './planning/planner.js';
export { DEFAULT_SIDECAR_EXTENSIONS, findSidecars, type Sidecar } from './planning/sidecars.js';
export { executePlan, type ExecuteOptions } from './execution/executor.js';
export { MemoryJournal } from './journal/memory-journal.js';
export { SqliteJournal } from './journal/sqlite-journal.js';
export { undoBatch, undoLastBatch, type UndoEntryResult, type UndoResult } from './journal/undo.js';
export {
  discoverVideos,
  isSample,
  VIDEO_EXTENSIONS,
  type DiscoveredFile,
} from './pipeline/discover.js';
export {
  analyze,
  type Analysis,
  type AnalysisEntry,
  type AnalyzeOptions,
  type Classification,
} from './pipeline/analyze.js';
export {
  CONFIG_FILE,
  configDirectory,
  DATABASE_FILE,
  editConfig,
  ensureConfigDirectory,
  loadConfig,
  type Config,
  type ConfigEdit,
  type NotifyConfig,
} from './config/config.js';
export {
  resolveSettings,
  type Settings,
  type SettingsContext,
  type SettingsOverrides,
} from './config/settings.js';
export {
  cleanupStaleTemporaryFiles,
  MIN_STALE_AGE_HOURS,
  type CleanupOptions,
  type StaleFile,
} from './maintenance/stale-temporary.js';
export { applyMigrations } from './journal/migrations.js';
