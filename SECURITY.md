# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please report a vulnerability **privately**, through GitHub's
[private vulnerability reporting](https://github.com/DjLeChuck/kinoshelf/security/advisories/new),
not in a public issue. Include the version, how Kinoshelf is exposed (local network, reverse proxy,
internet) and the steps to reproduce.

You can expect an answer within a week. A fix is released as soon as it is ready, and the advisory
credits you unless you prefer otherwise.

## Scope

Kinoshelf is meant for a home server. It protects `/api` with an API key, limits wrong attempts per
address, and refuses requests to the local network when it fetches an image address. Anything that
gets around one of these, reads or writes a file outside what the settings allow, or leaks a secret
(the diagnostic archive and the logs are meant to hold none) is in scope. Exposing the server to the
internet without a reverse proxy and `KINOSHELF_TRUST_PROXY` set is a configuration choice, see the
[installation guide](docs/0-installation.md).
