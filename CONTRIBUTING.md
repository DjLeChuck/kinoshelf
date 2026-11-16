# Contributing

Thanks for helping. Setup, the commands and the test suites are in
[docs/9-development.md](docs/9-development.md).

- Open an issue before a large change, so the direction is agreed first.
- Everything is in English: code, comments, commit messages, docs.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(core): …`,
  `fix(cli): …`), scope being the package name, one concern each.
- Any user-facing text goes in both catalogs, `packages/i18n/src/en.ts` and `fr.ts`.
- `make check` (typecheck, lint, format, tests) must pass. A wrongly handled file name is a new entry in the
  matching corpus ([packages/corpus/README.md](packages/corpus/README.md)).
- A user-visible change adds a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
