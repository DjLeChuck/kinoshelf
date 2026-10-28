# TMDB fixtures

Real responses recorded from the live TMDB API on 2026-10-28 with `pnpm fixtures:record` (needs
`TMDB_API_KEY` in `.env`; the script logs file names and statuses only, never a URL or header).
Re-run it to refresh them: it deletes and rewrites every `*.json` here.

- Season responses are trimmed: per-episode `crew` and `guest_stars` are removed (huge, and
  Kinoshelf never reads them). Everything else is untouched.
- Tests assert on stable facts (ids, titles, years, episode numbers) or derive their expectations
  from the fixture itself, so a refresh should not break them.
- Cases TMDB cannot be asked for on demand (null dates, a 404 on alternative titles…) are built
  inline in the tests and marked as synthetic.
