# Matching corpus

Real release names with the outcome the matcher must reach, replayed offline against recorded
TMDB responses (`data/recordings.json`), so CI needs no key. It runs with `pnpm test`.

- `data/corpus.json`: entries `{ path, language?, note?, expect }`. `expect` is `matched` (this
  tmdb id, kind, and for a series this season and these episodes) or `review` (a human must
  decide). `language` is the TMDB metadata language (`fr` for a French library, default `en-US`).
- An entry may carry `"alias": {"tmdb": 2370, "kind": "series"}`: the file's title is then tied to
  that work, as if a human had validated it in the queue and the server had remembered it. The
  file must match that work (unless its season or episode does not exist there). Pair it with an
  entry of the same title without `alias` that expects `review`, and one with an episode the work
  lacks, so the corpus shows what the alias changes and what it does not vouch for.
- `data/baseline.json`: the lowest acceptable pass rate. A ratchet: raise it when the rate
  improves, never lower it without saying why in the PR.
- Gates (`test/corpus.test.ts`): **zero wrong automatic matches** (a file renamed to the wrong
  work, or renamed when it needed review, always fails; a miss that goes to review is safe), and
  a pass rate at or above the baseline.

```sh
pnpm corpus:report      # every verdict with its score and runners-up (needs the recordings)
pnpm corpus:record      # re-record the TMDB responses the entries need (needs TMDB_API_KEY in .env)
```

## Adding a library (a list of paths)

Everything runs from the repository root. Put `TMDB_API_KEY` in `.env` (git-ignored; never read or
print it). Scratch results and a disk cache of TMDB answers go to `packages/corpus/.work/`
(git-ignored), so a rerun after a code change costs no API call.

```sh
find . -type f > /abs/path/list.txt   # anything: only video files are kept

pnpm build
pnpm --filter @kinoshelf/corpus analyze /abs/path/list.txt --language fr --out /abs/path/before.json
pnpm --filter @kinoshelf/corpus inspect /abs/path/before.json   # what is not matched, and why
pnpm --filter @kinoshelf/corpus probe "Folder/File - S01E02.mkv" # guessit vs our parser on one path
```

Read the unmatched groups before changing anything: some are bugs, some are right.

1. **Parser bug** (a title cut, a number read as an episode): `probe` shows what guessit returned,
   fix `GuessitParser` and add a unit test.
2. **Scoring** (a right answer just under the threshold): look at the breakdown with `corpus:report`
   or a probe script before touching `matching/config.ts`; calibrate on the whole list, not on one
   series.
3. **Legitimately for a human**: homonyms without a year, absolute episode numbering, or a numbering
   that differs from TMDB (check the season's real episode count in the cached response). The
   episode cap exists for these: do not "fix" them.

After every change:

```sh
pnpm build
pnpm --filter @kinoshelf/corpus analyze /abs/path/list.txt --language fr --out /abs/path/after.json
pnpm --filter @kinoshelf/corpus compare /abs/path/before.json /abs/path/after.json
```

`compare` must show **no file matched before and different now**, except wrong matches that become
right; look at every newly matched work to check it is the right one.

## Turning a list into entries

```sh
pnpm --filter @kinoshelf/corpus select /abs/path/after.json --curated curated.json
pnpm --filter @kinoshelf/corpus merge            # entries.json from .work/, skips duplicates
pnpm prettier --write packages/corpus
pnpm corpus:record && pnpm corpus:report
```

`select` keeps one episode per series, movies picked to stress the matcher (subtitle after a dash,
digit or roman numeral, apostrophe or accent, score below 100) and a few ordinary ones. The expected
result of a matched file comes from the matcher, so it proves nothing: entries whose title and year
agree with the file name are verified, the others are listed in `entries.confirm.json` and **a human
must confirm them**. `curated.json` adds the cases that are not simply "matched":

```json
[
  { "match": "Friends - S07E24", "outcome": "review", "note": "TMDB numbers season 7 differently" },
  { "match": "Kaamelott - S01E49", "outcome": "matched", "tmdb": 11466, "note": "year off by two" }
]
```

Then check that a new rule is really locked in: break the matcher on purpose (a threshold, a cap) and
see the corpus go red. A cap that no entry exercises can be removed without any test noticing.

## Baseline history

The baseline moves with the corpus, not only up. Lowering it is allowed when the corpus grows with
harder entries and nothing regressed; write the reason here.

- 0.96 to 0.98: a first real library (about 60 entries) replaced invented names.
- 0.98 to 0.99: a series' year became a weak hint, and Kaamelott and Le Bureau des légendes passed.
- 0.99 to 0.98: 41 entries from a second library (English release names matched through French TMDB
  titles) added one known gap, a bilingual title (`Anatomy.Of.A.Fall-Anatomie.d.une.chute`),
  with no regression: 281 of 284.
- 0.98 to 0.99: a validated title is remembered as an alias, so `Gordon.Ramsay.Hells.Kitchen` passes
  (the entry with its alias), with two guard entries added: 284 of 286.

## Things to know

- `analyze` keeps video files only (a raw `find` also lists subtitles, `.nfo`, images and folders)
  and skips hidden entries (`._x.avi` from macOS, dotfiles), as the scanner does.
- The parser reads only the last three path segments; entries keep no more.
- The list is committed to a public repository: names of release groups and titles are visible.
  Ask whoever supplied a list, and let them remove what they prefer not to show.
- `recordings.json` holds only what Kinoshelf reads (search results, alternative titles, season
  episodes), about 600 KB for 243 entries. If it grows past a few megabytes, move it to Git LFS
  (`.gitattributes`, `lfs: true` on the CI checkout) rather than trimming more.
- Lessons already paid for: guessit-js can return arrays where its types promise scalars; its
  `alternative_title` is the part after `-` of a movie name; it reads `2049` as S20E49, `116` as
  S01E16 and a year as a season; an apostrophe is a word break in `d'Amélie` and nothing in
  `Hell's`; a series' year in a folder name is unreliable (first release, local release, a guess);
  TMDB's season numbering differs from the one in many libraries.
