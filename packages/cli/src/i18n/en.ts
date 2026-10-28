import type { ErrorCode } from '@kinoshelf/core';
import type { CliErrorCode } from '../errors.js';

/**
 * English catalog and source of truth for the keys: `fr.ts` must have exactly the same ones.
 * `{name}` marks a parameter. Every error code must have an `error.<code>` entry, which
 * `errorMessagesAreComplete` enforces at compile time.
 */
export const en = {
  'error.destination.exists': 'A file already exists at {path}; it was left untouched.',
  'error.discover.not-found': 'Path not found: {path}',
  'error.fs.error': 'File system error ({code}) on {path}',
  'error.fs.no-space': 'No space left on the device for {path}',
  'error.fs.permission-denied': 'Permission denied for {path}',
  'error.fs.read-only': 'The file system is read-only at {path}',
  'error.hardlink.cross-device':
    'Cannot hardlink: {source} and {destination} are on different file systems. Choose copy or move, or use a destination on the same volume.',
  'error.hardlink.unsupported':
    'This file system does not support hardlinks ({destination}). Choose copy or move.',
  'error.main-not-done': 'Skipped because the video file itself was not transferred.',
  'error.move.verification-failed':
    'The moved copy of {source} does not match the original; the source was kept.',
  'error.operation.unsupported': 'Operation not supported yet: {type}',
  'error.plan.episode-numbers-missing': 'The season or episode number could not be determined.',
  'error.plan.outside-root': 'The target path would leave the destination folder.',
  'error.plan.profile-feature-unsupported':
    'This profile uses {feature}, which is not supported yet.',
  'error.plan.unsafe-segment': 'The title would produce an unsafe folder or file name.',
  'error.profile.double-quoted-escape':
    'Invalid profile: templates containing \\{ or \\} must use single quotes. ({detail})',
  'error.profile.invalid': 'Invalid profile at "{path}": {detail}',
  'error.profile.invalid-path': 'Invalid template in {field}: "{template}"',
  'error.profile.unknown': 'Unknown profile "{id}".',
  'error.profile.unknown-variable': 'Unknown variable {variable} in {field}.',
  'error.profile.yaml-syntax': 'The profile is not valid YAML: {detail}',
  'error.provider.foreign-id': 'An id from provider "{received}" cannot be used with "{expected}".',
  'error.source.missing': 'Source file not found: {path}',
  'error.template.empty-segment':
    'The name template produced an empty folder or file name: {template}',
  'error.template.invalid-escape':
    'Invalid escape in template "{template}" at position {position}.',
  'error.template.invalid-variable': 'Invalid variable "{variable}" in template "{template}".',
  'error.template.missing-variable': 'Cannot build the name: no value for {variable}.',
  'error.template.pad-on-text': 'Zero padding cannot be applied to the text variable {variable}.',
  'error.template.unexpected-brace':
    'Unexpected "}" in template "{template}" at position {position}.',
  'error.tmdb.http-error': 'TMDB answered with HTTP {status}.',
  'error.tmdb.invalid-key': 'TMDB rejected the API key. Check TMDB_API_KEY or the config file.',
  'error.tmdb.invalid-response': 'TMDB sent a response Kinoshelf does not understand.',
  'error.tmdb.network':
    'Could not reach TMDB. Check the network and retry; what was already fetched is cached.',
  'error.tmdb.not-found': 'TMDB has no such resource.',
  'error.tmdb.rate-limited':
    'TMDB is limiting requests. Retry in a moment; what was already fetched is cached.',
  'error.undo.destination-missing': 'Already gone: {path}',
  'error.undo.source-exists': 'Cannot put the file back: something now exists at {path}.',

  'error.config.destination-required':
    'Give a destination with --dest (or --dest-movies and --dest-series).',
  'error.config.invalid': 'Invalid configuration file {path}: {detail}',
  'error.config.invalid-value': 'Invalid value "{value}" for {option}.',
  'error.config.tmdb-key-missing':
    'No TMDB API key. Set the TMDB_API_KEY environment variable or "apiKey.tmdb" in {path}.',
  'error.unknown': 'Unexpected error ({code}).',

  'conflict.destination-exists': 'the destination already exists',
  'conflict.duplicate-destination': 'another file of this run has the same destination',
  'conflict.hardlink-cross-device': 'hardlink impossible: different file systems',
  'conflict.unresolvable-name': 'the target name cannot be built',
  'unrecognized.no-title': 'no title could be read from the file name',
  'unrecognized.no-candidates': 'nothing found on TMDB',

  'report.none': 'No video files found.',
  'report.analyzed': 'Video files analyzed: {count} · profile {profile} · mode {mode}',
  'report.destination': 'Destination: {destination}',
  'report.destinations': 'Destinations: movies {movies} · series {series}',
  'section.compliant': 'Already in place',
  'section.to-rename': 'To organize',
  'section.conflict': 'Held back',
  'section.ambiguous': 'Ambiguous (needs validation)',
  'section.unrecognized': 'Unrecognized (needs validation)',
  'entry.score': 'score {score}',
  'entry.sidecars': '+ {count} companion file(s)',
  'entry.candidate': '{title} ({year}) · score {score} · tmdb {id}',
  'entry.candidate-no-year': '{title} · score {score} · tmdb {id}',
  'summary.line':
    'Summary: {compliant} in place, {toRename} to organize, {conflict} held back, {ambiguous} ambiguous, {unrecognized} unrecognized.',
  'notice.scan': 'Read-only scan. Use "process --apply" to organize these files.',
  'notice.dry-run': 'Dry run: nothing was written. Add --apply to execute.',

  'apply.header': 'Executing batch {batch}',
  'result.skipped': 'skipped: {reason}',
  'result.failed': 'failed: {reason}',
  'batch.summary': 'Batch {batch}: {done} done, {skipped} skipped, {failed} failed.',
  'batch.undo-hint': 'To revert it: kinoshelf undo --apply',

  'undo.nothing': 'Nothing to undo.',
  'undo.header': 'Last batch: {batch}',
  'undo.skipped': 'skipped: {reason}',
  'undo.failed': 'failed: {reason}',
  'undo.summary': '{undone} reverted, {skipped} skipped, {failed} failed.',
  'undo.dry-run': 'Dry run: nothing was changed. Add --apply to revert.',

  'help.description': 'Identify, rename and enrich video files already on disk.',
  'help.scan': 'Analyze a library and report what would change (never writes).',
  'help.process': 'Identify a file or folder and organize it (dry run unless --apply).',
  'help.undo': 'Revert the last executed batch (dry run unless --apply).',
  'help.arg.source': 'folder or video file to analyze',
  'help.arg.path': 'video file or folder to process',
  'help.opt.dest': 'destination folder for movies and series',
  'help.opt.dest-movies': 'destination folder for movies',
  'help.opt.dest-series': 'destination folder for series',
  'help.opt.profile': 'output profile: a bundled id or the path of a YAML file',
  'help.opt.mode':
    'copy, hardlink or move (default: move when the destination is the source folder, else copy)',
  'help.opt.threshold': 'minimum score (0-100) for automatic processing',
  'help.opt.metadata-language': 'language of the titles fetched from TMDB, e.g. fr or en-US',
  'help.opt.lang': 'language of this tool: fr or en',
  'help.opt.json': 'print machine-readable JSON instead of text',
  'help.opt.apply': 'actually write to disk',
  'help.opt.config-dir': 'folder holding config.yaml and the database',
} as const;

/** Fails to compile when an error code has no `error.<code>` message. */
export const errorMessagesAreComplete: Record<`error.${ErrorCode | CliErrorCode}`, string> = en;
