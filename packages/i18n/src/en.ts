import type { ErrorCode } from '@kinoshelf/core';
import type { CliErrorCode, ServerErrorCode } from './codes.js';

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
  'error.config.dir-not-writable':
    'Cannot write to the config directory {path} (running as uid {uid}). Make it writable for that user.',
  'error.config.invalid': 'Invalid configuration file {path}: {detail}',
  'error.undo.batch-already-undone': 'Batch {batch} was already reverted.',
  'error.undo.batch-not-found': 'No batch {batch} in the journal.',
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
  'batch.undo-hint': 'To revert it: kinoshelf undo {batch} --apply',

  'undo.nothing': 'Nothing to undo.',
  'undo.header': 'Batch: {batch}',
  'undo.skipped': 'skipped: {reason}',
  'undo.failed': 'failed: {reason}',
  'undo.summary': '{undone} reverted, {skipped} skipped, {failed} failed.',
  'undo.dry-run': 'Dry run: nothing was changed. Add --apply to revert.',

  'notify.transferred.title': '{count} file(s) transferred',
  'notify.transferred.message': '{count} file(s) transferred from {path}.',
  'notify.failed.job.title': 'Analysis failed',
  'notify.failed.job.message': 'The analysis of {path} failed: {reason}',
  'notify.failed.execution.title': 'Transfer failed',
  'notify.failed.execution.message': 'The transfer of {path} failed: {reason}',
  'notify.failed.files.title': '{failed} file(s) not transferred',
  'notify.failed.files.message': '{done} transferred, {failed} not transferred ({path}).',
  'notify.failed.file': '{name}: {reason}',
  'notify.review.title': '{count} file(s) to review',
  'notify.review.message':
    '{count} file(s) of {path} need a decision: {ambiguous} ambiguous, {unrecognized} unrecognized, {conflict} in conflict.',
  'notify.test.title': 'Kinoshelf test',
  'notify.test.message': 'This is a test notification.',

  'error.server.port-in-use':
    'Port {port} is already in use on {host}: another server is listening there. Stop it, or choose another port with KINOSHELF_PORT.',
  'error.server.port-denied':
    'Not allowed to listen on port {port} on {host}. Ports below 1024 need extra privileges: choose a higher one with KINOSHELF_PORT.',
  'server.help':
    'Usage: kinoshelf-server [command]\n\nWithout a command, starts the server (KINOSHELF_HOST, KINOSHELF_PORT, KINOSHELF_CONFIG_DIR).\n\nCommands:\n  api-key create                 create the API key and print it (it replaces the previous one)\n  notify test                    check the webhooks, Plex and Jellyfin set in config.yaml\n  notify refresh <path> [--kind movie|series] [--dry-run]\n                                 ask Plex and Jellyfin to look at a folder, as Kinoshelf sees it\n  --help                         show this help',
  'help.description': 'Identify, rename and enrich video files already on disk.',
  'help.scan': 'Analyze a library and report what would change (never writes).',
  'help.process': 'Identify a file or folder and organize it (dry run unless --apply).',
  'help.undo':
    'Revert an executed batch, the last one unless you name it (dry run unless --apply).',
  'help.arg.batch': 'id of the batch to revert (printed when it was applied)',
  'help.cleanup':
    'Remove the temporary files an interrupted copy left in the destination folders (dry run unless --apply).',
  'help.arg.folders': 'folders to scan (default: the destinations of config.yaml)',
  'help.opt.older-than':
    'only files untouched for at least this many hours (default 24, minimum 1)',
  'cleanup.header': 'Stale temporary files (untouched for {hours} h or more) in: {folders}',
  'cleanup.none': 'No stale temporary file found.',
  'cleanup.file': '{size} · untouched for {age} h',
  'cleanup.summary': '{found} found, {removed} removed, {failed} failed.',
  'cleanup.dry-run': 'Dry run: nothing was removed. Add --apply to delete them.',
  'error.cleanup.age-too-short':
    'The minimum age is {min} hour: a younger file may still be being copied.',
  'error.cleanup.no-folder': 'Give the folder(s) to scan, or set "destination" in {path}.',
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
  'error.auth.not-configured':
    'No API key exists yet. Run “kinoshelf-server api-key create”, or set KINOSHELF_API_KEY.',
  'error.auth.unauthorized': 'Wrong API key, or your session has expired.',
  'error.batch.already-undone': 'This batch was already undone.',
  'error.batch.not-found': 'This batch does not exist.',
  'error.execution.not-found': 'This transfer does not exist.',
  'error.image.not-found': 'This image does not exist.',
  'error.image.unavailable': 'The image could not be fetched from TMDB.',
  'error.internal.unexpected': 'Something went wrong on the server. See its log for details.',
  'error.job.busy': 'A transfer is already queued or running for this job.',
  'error.job.not-done': 'This job has not finished its analysis yet ({status}).',
  'error.job.not-found': 'This job does not exist.',
  'error.queue.entry-not-found': 'This file is not in the queue any more.',
  'error.queue.entry-resolved': 'This file was already handled ({resolution}).',
  'error.request.invalid': 'The request was refused: {detail}',
  'error.request.not-found': 'Nothing at this address.',
  'error.request.rejected': 'The request was refused: {detail}',
  'error.settings.api-key-from-env':
    'The API key is set by KINOSHELF_API_KEY, which would put it back at the next start. Change the variable instead.',
  'error.settings.webhook-not-found': 'This webhook no longer exists. Reload the settings.',
  'error.settings.webhook-url-required': 'A new webhook needs a URL.',
  'web.skip-to-content': 'Skip to content',
  'web.nav.label': 'Main navigation',
  'web.nav.queue': 'Queue',
  'web.nav.media': 'Movies & series',
  'web.nav.libraries': 'Libraries',
  'web.nav.history': 'History',
  'web.nav.settings': 'Settings',
  'web.soon.badge': 'Coming soon',
  'web.soon.media.title': 'Movies & series',
  'web.soon.media.body':
    'Browse your library, see what is missing (NFO, artwork, subtitles) and rewrite it. It needs the Jellyfin and NFO profiles of version 1.0.',
  'web.soon.libraries.title': 'Libraries',
  'web.soon.libraries.body':
    'Several libraries with their own folders, profile, file mode and threshold, and a watched folder. Until then, set them in the settings or in config.yaml.',
  'web.soon.scan.title': 'Scan result',
  'web.soon.scan.body':
    'Classify a whole library and process it by batch. Until then, “kinoshelf scan” and “kinoshelf process” do it from the command line.',
  'web.login.title': 'Sign in',
  'web.login.intro': 'Enter the API key of this Kinoshelf instance.',
  'web.login.key': 'API key',
  'web.login.submit': 'Sign in',
  'web.login.hint': 'Create one with “kinoshelf-server api-key create”.',
  'web.signout': 'Sign out',
  'web.theme.label': 'Theme',
  'web.theme.dark': 'Dark',
  'web.theme.light': 'Light',
  'web.theme.system': 'System',
  'web.locale.label': 'Language',
  'web.loading': 'Loading…',
  'web.retry': 'Retry',
  'web.error.network': 'Cannot reach the server. Check that it is running.',
  'web.tmdb-attribution':
    'This product uses the TMDB API but is not endorsed or certified by TMDB. Kinoshelf is distributed under the MIT license.',
  'web.not-found.title': 'Page not found',
  'web.not-found.back': 'Back to the queue',
} as const;

/** Fails to compile when an error code has no `error.<code>` message. */
export const errorMessagesAreComplete: Record<
  `error.${ErrorCode | CliErrorCode | ServerErrorCode}`,
  string
> = en;
