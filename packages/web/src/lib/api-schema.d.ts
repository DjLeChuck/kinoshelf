// Generated from the server's schemas by packages/server/test/api-types.test.ts: do not edit.
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "ok";
                            version: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tell whether the browser has a valid session */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            authenticated: boolean;
                            /** @description No API key exists yet: the first launch can create one (`POST /api/setup/api-key`). */
                            setup?: boolean;
                            /** @description What to type to run the server's commands, such as `api-key create`. */
                            command: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** Sign in to the web UI with the API key */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        apiKey: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            authenticated: boolean;
                            /** @description No API key exists yet: the first launch can create one (`POST /api/setup/api-key`). */
                            setup?: boolean;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        /** Sign out of the web UI */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/setup/api-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create the first API key
         * @description Only while no key exists (409 `setup.already-done` after), and only through a local host name (403 `setup.host-not-allowed`; see `KINOSHELF_ALLOWED_HOSTS`). The key is returned once and only its hash is kept.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            apiKey: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream of changes (Server-Sent Events)
         * @description Each event is named after what changed (`jobs`, `progress`, `arrivals`, `history`, `settings`, `logs`, `tmdb`) and carries no data: refetch the matching list. `progress` is only where a running analysis is (`GET /api/jobs/{id}`), at most twice a second; `jobs` is a job queued, started or ended; `logs` is lines written, at most twice a second; `tmdb` is TMDB counts written, every few seconds at most. A `ready` event opens the stream.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description text/event-stream */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description `events.too-many` while 64 streams are open */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": unknown;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The settings the UI edits
         * @description Secrets are never returned: a key or a token is reported as set or not, and a webhook by its origin. They live in `config.yaml`, which this edits in place (comments are kept).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            tmdb: {
                                configured: boolean;
                                /** @enum {string|null} */
                                source: "env" | "file" | null;
                                language: string | null;
                            };
                            /** @enum {string|null} */
                            locale: "en" | "fr" | null;
                            /** @enum {string|null} */
                            plexAccount: "signed-in" | "expired" | null;
                            plex: {
                                url: string;
                                section: number | null;
                                tokenConfigured: boolean;
                                paths: {
                                    from: string;
                                    to: string;
                                }[];
                            } | null;
                            jellyfin: {
                                url: string;
                                tokenConfigured: boolean;
                                paths: {
                                    from: string;
                                    to: string;
                                }[];
                            } | null;
                            webhooks: {
                                /** @description Names this webhook in a `PATCH`. */
                                id: string;
                                /** @description The origin only: the rest of a URL is a secret. */
                                target: string;
                                /** @enum {string} */
                                format: "generic" | "gotify" | "ntfy" | "discord";
                                on: ("transferred" | "failed" | "needs-review")[];
                            }[];
                            watch: {
                                settleSeconds: number | null;
                                pollSeconds: number | null;
                                apply: boolean;
                            } | null;
                            processing: {
                                /** @enum {string|null} */
                                naming: "with-id" | "no-id" | null;
                                /** @enum {string|null} */
                                metadata: "none" | "nfo" | null;
                                /** @enum {string|null} */
                                mode: "copy" | "hardlink" | "move" | null;
                                threshold: number | null;
                                detectPictureSize: boolean;
                                allowLocalImageUrls: boolean;
                            };
                            /** @description A movie and an episode path as each naming would write them. */
                            namingExamples: {
                                "with-id": {
                                    movie: string;
                                    series: string;
                                };
                                "no-id": {
                                    movie: string;
                                    series: string;
                                };
                            };
                            apiKey: {
                                /**
                                 * @description Where the key comes from. It cannot be read back, only replaced.
                                 * @enum {string|null}
                                 */
                                source: "env" | "database" | null;
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change settings
         * @description Only what is sent changes: `null` removes a value, a value sets it. `webhooks` is the whole list; name an existing one by its `id` to keep its URL. Applied at once, without a restart. An invalid result is refused (409 `config.invalid`) and nothing is written.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        tmdb?: {
                            apiKey?: string | null;
                            language?: string | null;
                        };
                        /** @enum {string|null} */
                        locale?: "en" | "fr" | null;
                        plex?: {
                            /** Format: uri */
                            url: string;
                            section?: number | null;
                            token?: string | null;
                            paths?: {
                                from: string;
                                to: string;
                            }[] | null;
                        } | null;
                        jellyfin?: {
                            /** Format: uri */
                            url: string;
                            token?: string | null;
                            paths?: {
                                from: string;
                                to: string;
                            }[] | null;
                        } | null;
                        webhooks?: {
                            id?: string;
                            /** Format: uri */
                            url?: string;
                            /** @enum {string|null} */
                            format?: "generic" | "gotify" | "ntfy" | "discord" | null;
                            on?: ("transferred" | "failed" | "needs-review")[] | null;
                            headers?: {
                                [key: string]: string;
                            } | null;
                        }[];
                        watch?: {
                            settleSeconds?: number | null;
                            pollSeconds?: number | null;
                            apply?: boolean | null;
                        } | null;
                        processing?: {
                            /** @enum {string|null} */
                            naming?: "with-id" | "no-id" | null;
                            /** @enum {string|null} */
                            metadata?: "none" | "nfo" | null;
                            /** @enum {string|null} */
                            mode?: "copy" | "hardlink" | "move" | null;
                            threshold?: number | null;
                            detectPictureSize?: boolean | null;
                            allowLocalImageUrls?: boolean | null;
                        };
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            tmdb: {
                                configured: boolean;
                                /** @enum {string|null} */
                                source: "env" | "file" | null;
                                language: string | null;
                            };
                            /** @enum {string|null} */
                            locale: "en" | "fr" | null;
                            /** @enum {string|null} */
                            plexAccount: "signed-in" | "expired" | null;
                            plex: {
                                url: string;
                                section: number | null;
                                tokenConfigured: boolean;
                                paths: {
                                    from: string;
                                    to: string;
                                }[];
                            } | null;
                            jellyfin: {
                                url: string;
                                tokenConfigured: boolean;
                                paths: {
                                    from: string;
                                    to: string;
                                }[];
                            } | null;
                            webhooks: {
                                /** @description Names this webhook in a `PATCH`. */
                                id: string;
                                /** @description The origin only: the rest of a URL is a secret. */
                                target: string;
                                /** @enum {string} */
                                format: "generic" | "gotify" | "ntfy" | "discord";
                                on: ("transferred" | "failed" | "needs-review")[];
                            }[];
                            watch: {
                                settleSeconds: number | null;
                                pollSeconds: number | null;
                                apply: boolean;
                            } | null;
                            processing: {
                                /** @enum {string|null} */
                                naming: "with-id" | "no-id" | null;
                                /** @enum {string|null} */
                                metadata: "none" | "nfo" | null;
                                /** @enum {string|null} */
                                mode: "copy" | "hardlink" | "move" | null;
                                threshold: number | null;
                                detectPictureSize: boolean;
                                allowLocalImageUrls: boolean;
                            };
                            /** @description A movie and an episode path as each naming would write them. */
                            namingExamples: {
                                "with-id": {
                                    movie: string;
                                    series: string;
                                };
                                "no-id": {
                                    movie: string;
                                    series: string;
                                };
                            };
                            apiKey: {
                                /**
                                 * @description Where the key comes from. It cannot be read back, only replaced.
                                 * @enum {string|null}
                                 */
                                source: "env" | "database" | null;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/settings/tmdb/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check that the TMDB key works
         * @description Runs a search with the key in use (`tmdb.invalid-key` if TMDB refuses it).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/api-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace the API key
         * @description The new key is returned once and cannot be read again. Scripts using the old one stop working at once; a browser session stays open.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            apiKey: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plex/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start signing in to Plex
         * @description Asks plex.tv for a PIN. Open `url` in a browser; the user signs in there, then `GET /api/plex/auth/{id}` tells when it is done.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            url: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        /**
         * Sign out of Plex
         * @description Forgets the token. The device stays in the account’s authorized devices, where it can be revoked on plex.tv.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plex/auth/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Has the PIN been claimed?
         * @description Called every couple of seconds while the user signs in on plex.tv. Once `done` is true the token is kept (and renewed from then on); a token typed in the settings is dropped, since the sign-in replaces it.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            done: boolean;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plex/servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The Plex servers of the signed-in account
         * @description To pick the address of the server instead of typing it. Local addresses come first, then remote ones, and relays (limited bandwidth) last.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            servers: {
                                name: string;
                                owned: boolean;
                                connections: {
                                    uri: string;
                                    local: boolean;
                                    relay: boolean;
                                }[];
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Progress of the first-launch setup */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description The welcome page is over: the user left it, or the install already did work. */
                            completed: boolean;
                            steps: {
                                /** @enum {string} */
                                id: "tmdb" | "server" | "destination" | "source";
                                /** @enum {string} */
                                state: "todo" | "done" | "skipped";
                                /** @description Done because the configuration says so. */
                                auto: boolean;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Mark a step done or skipped, reopen it, or finish the welcome page
         * @description `{ step, state }` with `state` `null` to reopen; `{ finished: true }` leaves the welcome page for good.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        step?: "tmdb" | "server" | "destination" | "source";
                        /** @enum {string|null} */
                        state?: "done" | "skipped" | null;
                        /** @enum {boolean} */
                        finished?: true;
                    } | unknown | unknown;
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description The welcome page is over: the user left it, or the install already did work. */
                            completed: boolean;
                            steps: {
                                /** @enum {string} */
                                id: "tmdb" | "server" | "destination" | "source";
                                /** @enum {string} */
                                state: "todo" | "done" | "skipped";
                                /** @description Done because the configuration says so. */
                                auto: boolean;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/fs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a folder of the server
         * @description Sub-folders of an absolute path, for a path picker, and with `files=yaml` the YAML files too. Names only; hidden entries are left out and a symlink shows as its target. At most 2000 entries (`truncated` says when more exist).
         */
        get: {
            parameters: {
                query: {
                    path: string;
                    files?: "yaml";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            path: string;
                            parent: string | null;
                            entries: {
                                name: string;
                                /** @enum {string} */
                                kind: "directory" | "file";
                            }[];
                            truncated: boolean;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The libraries, with the state of their last scan
         * @description A library is a source folder (what a scan reads). With a `type` it is organized in place and is also a destination; with `into` (the ids of a movie and a series library) it is an arrival folder, with its own mode. `naming` and `metadata` go with `type`, `mode` with `into`; a field that is `null` follows the global setting. `lastScan` is the latest scan of the whole source, queued, running, failed or done (its job in `GET /api/jobs/{id}`); what the library holds is `GET /api/libraries/{id}/items`.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            source: string;
                            /** @enum {string|null} */
                            type: "movie" | "series" | null;
                            into: {
                                movie: string;
                                series: string;
                            } | null;
                            /** @enum {string|null} */
                            naming: "with-id" | "no-id" | null;
                            /** @enum {string|null} */
                            metadata: "none" | "nfo" | null;
                            /** @enum {string|null} */
                            mode: "copy" | "hardlink" | "move" | null;
                            threshold: number | null;
                            watch: boolean;
                            lastScan: {
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                            } | null;
                            scanning: boolean;
                        }[];
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Add a library
         * @description The id is made from the name. The source must be an existing folder (422 `fs.not-found`, `fs.not-a-directory`, `fs.unreadable`), exactly one of `type` and `into` is given and `into` names libraries of the right type (422 `library.invalid`), and no other library may have the same source (409 `library.source-taken`).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        source: string;
                        /** @enum {string} */
                        type?: "movie" | "series";
                        into?: {
                            movie: string;
                            series: string;
                        };
                        /** @enum {string} */
                        naming?: "with-id" | "no-id";
                        /** @enum {string} */
                        metadata?: "none" | "nfo";
                        /** @enum {string} */
                        mode?: "copy" | "hardlink" | "move";
                        threshold?: number;
                        watch?: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            source: string;
                            /** @enum {string|null} */
                            type: "movie" | "series" | null;
                            into: {
                                movie: string;
                                series: string;
                            } | null;
                            /** @enum {string|null} */
                            naming: "with-id" | "no-id" | null;
                            /** @enum {string|null} */
                            metadata: "none" | "nfo" | null;
                            /** @enum {string|null} */
                            mode: "copy" | "hardlink" | "move" | null;
                            threshold: number | null;
                            watch: boolean;
                            lastScan: {
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                            } | null;
                            scanning: boolean;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a library
         * @description Forgets the library and what its scans saw: its files stay where they are, and the jobs it started keep their history. 409 `library.in-use` while an arrival folder sends its files to it.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /**
         * Change a library
         * @description Only what is sent changes; `null` removes `naming`, `metadata`, `mode`, `threshold` or `into`; the type never changes. The id never changes. Same validation as `POST /api/libraries`. Files already planned keep the settings they were planned with; the next scan uses the new ones.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        source?: string;
                        /** @enum {string} */
                        type?: "movie" | "series";
                        into?: {
                            movie: string;
                            series: string;
                        } | null;
                        /** @enum {string|null} */
                        naming?: "with-id" | "no-id" | null;
                        /** @enum {string|null} */
                        metadata?: "none" | "nfo" | null;
                        /** @enum {string|null} */
                        mode?: "copy" | "hardlink" | "move" | null;
                        threshold?: number | null;
                        watch?: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            source: string;
                            /** @enum {string|null} */
                            type: "movie" | "series" | null;
                            into: {
                                movie: string;
                                series: string;
                            } | null;
                            /** @enum {string|null} */
                            naming: "with-id" | "no-id" | null;
                            /** @enum {string|null} */
                            metadata: "none" | "nfo" | null;
                            /** @enum {string|null} */
                            mode: "copy" | "hardlink" | "move" | null;
                            threshold: number | null;
                            watch: boolean;
                            lastScan: {
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                            } | null;
                            scanning: boolean;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/libraries/{id}/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Scan a library now
         * @description Queues an analysis of the whole source with the library’s settings; nothing is written to the disk. Poll `GET /api/jobs/{id}` (or follow the `jobs` event), then read `GET /api/libraries/{id}/items` and run chosen items with `POST /api/libraries/{id}/execute`. 409 `library.scan-in-progress` while a scan of this library is queued or running.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            path: string;
                            libraryId: string | null;
                            /** @enum {string} */
                            status: "queued" | "running" | "done" | "failed";
                            apply: boolean;
                            /** Format: date-time */
                            startedAt: string | null;
                            /** Format: date-time */
                            finishedAt: string | null;
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                            execution: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                                progress?: {
                                    done: number;
                                    total: number;
                                    current: string | null;
                                } | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                startedAt: string | null;
                                /** Format: date-time */
                                finishedAt: string | null;
                                batchId: string | null;
                                summary: {
                                    done: number;
                                    failed: number;
                                } | null;
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            } | null;
                            summary: {
                                compliant: number;
                                "to-rename": number;
                                conflict: number;
                                ambiguous: number;
                                unrecognized: number;
                            } | null;
                            progress: {
                                /** @enum {string} */
                                phase: "discover" | "read" | "identify" | "plan";
                                found: number;
                                done: number;
                                total: number;
                                current: string | null;
                                idleSeconds: number;
                            } | null;
                            transfer?: {
                                done: number;
                                total: number;
                                current: string | null;
                            } | null;
                            settings: {
                                profile: {
                                    /** @enum {string} */
                                    naming: "with-id" | "no-id";
                                    /** @enum {string} */
                                    metadata: "none" | "nfo";
                                };
                                /** @enum {string} */
                                mode: "copy" | "hardlink" | "move";
                                destinationRoot: string | {
                                    movie: string;
                                    series: string;
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/rescan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Scan one folder of a library again
         * @description Queues an analysis of a movie’s folder, a show’s or a season’s (or a file), read as it would be inside a scan of the whole source. When it ends, the rows under that path replace the library’s; the others stay. The library must hold a type. 422 `library.outside` for a path that is not strictly inside the source, `fs.not-found` for one that is gone; 409 `library.scan-in-progress` while a scan of this library is queued or running. With a `candidate` (the work the folder was wrongly matched to is corrected), its files are named after that work rather than searched for, so the rows come back to rename; the candidate must be of the library’s type (422 `library.wrong-type`).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        path: string;
                        candidate?: {
                            /** @enum {string} */
                            kind: "movie" | "series";
                            id: {
                                /** @enum {string} */
                                provider: "tmdb";
                                id: number;
                            };
                            title: string;
                            originalTitle?: string;
                            year?: number;
                            posterPath?: string;
                            alternativeTitles?: string[];
                            overview?: string;
                            popularity?: number;
                            countries?: string[];
                        };
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            path: string;
                            libraryId: string | null;
                            /** @enum {string} */
                            status: "queued" | "running" | "done" | "failed";
                            apply: boolean;
                            /** Format: date-time */
                            startedAt: string | null;
                            /** Format: date-time */
                            finishedAt: string | null;
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                            execution: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                                progress?: {
                                    done: number;
                                    total: number;
                                    current: string | null;
                                } | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                startedAt: string | null;
                                /** Format: date-time */
                                finishedAt: string | null;
                                batchId: string | null;
                                summary: {
                                    done: number;
                                    failed: number;
                                } | null;
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            } | null;
                            summary: {
                                compliant: number;
                                "to-rename": number;
                                conflict: number;
                                ambiguous: number;
                                unrecognized: number;
                            } | null;
                            progress: {
                                /** @enum {string} */
                                phase: "discover" | "read" | "identify" | "plan";
                                found: number;
                                done: number;
                                total: number;
                                current: string | null;
                                idleSeconds: number;
                            } | null;
                            transfer?: {
                                done: number;
                                total: number;
                                current: string | null;
                            } | null;
                            settings: {
                                profile: {
                                    /** @enum {string} */
                                    naming: "with-id" | "no-id";
                                    /** @enum {string} */
                                    metadata: "none" | "nfo";
                                };
                                /** @enum {string} */
                                mode: "copy" | "hardlink" | "move";
                                destinationRoot: string | {
                                    movie: string;
                                    series: string;
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What a library holds, as its last scan saw it
         * @description Read from the snapshot a scan leaves, never from the disk: listing costs nothing, and transfers and undos keep it in step. `state` filters (`missing-nfo` and `missing-artwork` look at the files, so one without either shows under both); `q` matches the title or the file name. `counts` do not depend on the filters. `scannedAt` is `null` until a scan of the source has ended; `scan` is the one queued or running. `writes` says which columns the profile gives a page. In a movie library that writes NFO, `collections` is true: each movie carries its `collection`, `collection` (`in`, `out`, `incomplete`, or a key `t:<id>` / `c:<name>`) narrows the list and `sort` orders it (a collection's movies by year, movies in none last). `collectionCounts` counts movies for those filters.
         */
        get: {
            parameters: {
                query?: {
                    state?: "review" | "rename" | "unrecognized" | "missing-nfo" | "missing-artwork" | "multi-version";
                    q?: string;
                    collection?: string;
                    sort?: "title" | "collection" | "year";
                    limit?: number;
                    offset?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            collectionCounts: {
                                all: number;
                                in: number;
                                out: number;
                                incomplete: number;
                            };
                            library: {
                                /** @description The library files its movies under collections (it writes NFO). */
                                collections: boolean;
                                writes: {
                                    nfo: boolean;
                                    artwork: boolean;
                                    logo: boolean;
                                    thumb: boolean;
                                };
                            };
                            /** Format: date-time */
                            scannedAt: string | null;
                            scan: {
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running";
                                progress: {
                                    /** @enum {string} */
                                    phase: "discover" | "read" | "identify" | "plan";
                                    found: number;
                                    done: number;
                                    total: number;
                                    current: string | null;
                                    idleSeconds: number;
                                } | null;
                                transfer: {
                                    done: number;
                                    total: number;
                                    current: string | null;
                                } | null;
                            } | null;
                            transfer: {
                                done: number;
                                total: number;
                                current: string | null;
                            } | null;
                            /** @description A movie library counts movies, however many versions each has. A series library counts shows, except `review` and `unrecognized`: those files belong to no show, so they stay counted as files. */
                            counts: {
                                all: number;
                                review: number;
                                rename: number;
                                unrecognized: number;
                                "missing-nfo": number;
                                "missing-artwork": number;
                                "multi-version": number;
                                "missing-episodes": number;
                                "missing-show-files": number;
                                "incomplete-versions": number;
                            };
                            /** @description Items matching the filters, for paging. */
                            total: number;
                            /** @description The same items counted as a validation settles them: the episodes of one release and series are one. */
                            groups: number;
                            items: {
                                /** @description Stable for a path: `GET /api/libraries/{id}/items/{itemId}`. */
                                id: string;
                                path: string;
                                /** @enum {string} */
                                state: "review" | "rename" | "unrecognized" | "incomplete" | "ok";
                                /** @enum {string|null} */
                                kind: "movie" | "series" | null;
                                /** @description The official title; the file name’s when nothing matched. */
                                title: string | null;
                                year: number | null;
                                tmdbId: number | null;
                                /** @description Series only. */
                                season: number | null;
                                /** @description Series only: the first episode. */
                                episode: number | null;
                                /** @description The last episode of a file holding several; `null` for a single one. */
                                episodeEnd: number | null;
                                /** @description Read in the file name, e.g. `1080p`. */
                                resolution: string | null;
                                /** @description `null`: the profile writes none, or it cannot be told. */
                                nfo: boolean | null;
                                poster: boolean | null;
                                fanart: boolean | null;
                                logo: boolean | null;
                                /** @description An episode’s own image, `<file>-thumb.jpg`; `null` for any other file. */
                                thumb: boolean | null;
                                /** @description Movie images the profile writes that TMDB has none of (and the disk neither): their flag above reads as there, since nothing is missing, but the list shows them as unavailable. */
                                unavailable: ("poster" | "fanart" | "logo")[];
                                /** @description To validate or change the match. */
                                entryId: string | null;
                                /** @description The folder the file came in: files sharing it (and its `cluster`) are validated together. Filled by the list of items only. */
                                release: string | null;
                                /** @description Which series of the release: 0 the main one, 1 and up the others. */
                                cluster: number | null;
                                /** @description Files a validation of this one settles: itself and the rest of its series in the release. */
                                releaseFiles: number | null;
                                versions: {
                                    /** @description What `POST /api/libraries/{id}/execute` takes. */
                                    id: string;
                                    path: string;
                                    /** @enum {string} */
                                    state: "review" | "rename" | "unrecognized" | "incomplete" | "ok";
                                    /** @description Read in the file name, e.g. `1080p`. */
                                    resolution: string | null;
                                    /** @description The NFO of this file is there: `<file>.nfo` for an episode, the shared `movie.nfo` for a movie (the same for every version). `null`: the profile writes none. */
                                    nfo: boolean | null;
                                    /** @description To validate or change the match. */
                                    entryId: string | null;
                                    /** @description What the snapshot knows of the file: a list never reads the disk, so `null` until the background probe got to it (the page of the item reads it at once). */
                                    file: {
                                        video: string | null;
                                        audio: string | null;
                                        /** @enum {string|null} */
                                        hdr: "dolby-vision" | "hdr10-plus" | "hdr10" | "hlg" | null;
                                        audioLanguages: string[];
                                        subtitleLanguages: string[];
                                        size: number;
                                    } | null;
                                }[];
                                collection: {
                                    /** @description Stable id of the collection in a library: `t:<TMDB id>` or `c:<name>`. */
                                    key: string;
                                    name: string;
                                    /** @description The owner’s own collection: it has no TMDB id. */
                                    custom: boolean;
                                    /** @description Movies of it that the library holds. */
                                    held: number;
                                    /** @description Movies TMDB lists in it; `null` for a custom collection, or when unknown. */
                                    total: number | null;
                                } | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/items/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The page of one item of a library
         * @description The item as the list gives it, plus what the provider knows of the work (summary, runtime in minutes, genres, `posterPath` and `backdropPath` for `GET /api/images`) and what `ffprobe` reads of the file (`file`: codec, audio, size in bytes). Both are best effort: with no TMDB answer or no `ffprobe`, the fields are empty and the page still works. The file is read now unless the snapshot already has it up to date.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Stable for a path: `GET /api/libraries/{id}/items/{itemId}`. */
                            id: string;
                            path: string;
                            /** @enum {string} */
                            state: "review" | "rename" | "unrecognized" | "incomplete" | "ok";
                            /** @enum {string|null} */
                            kind: "movie" | "series" | null;
                            /** @description The official title; the file name’s when nothing matched. */
                            title: string | null;
                            year: number | null;
                            tmdbId: number | null;
                            /** @description Series only. */
                            season: number | null;
                            /** @description Series only: the first episode. */
                            episode: number | null;
                            /** @description The last episode of a file holding several; `null` for a single one. */
                            episodeEnd: number | null;
                            /** @description Read in the file name, e.g. `1080p`. */
                            resolution: string | null;
                            /** @description `null`: the profile writes none, or it cannot be told. */
                            nfo: boolean | null;
                            poster: boolean | null;
                            fanart: boolean | null;
                            logo: boolean | null;
                            /** @description An episode’s own image, `<file>-thumb.jpg`; `null` for any other file. */
                            thumb: boolean | null;
                            /** @description Movie images the profile writes that TMDB has none of (and the disk neither): their flag above reads as there, since nothing is missing, but the list shows them as unavailable. */
                            unavailable: ("poster" | "fanart" | "logo")[];
                            /** @description To validate or change the match. */
                            entryId: string | null;
                            /** @description The folder the file came in: files sharing it (and its `cluster`) are validated together. Filled by the list of items only. */
                            release: string | null;
                            /** @description Which series of the release: 0 the main one, 1 and up the others. */
                            cluster: number | null;
                            /** @description Files a validation of this one settles: itself and the rest of its series in the release. */
                            releaseFiles: number | null;
                            /** @description The collection section of a movie of a library that writes NFO; `null` for anything else. `tmdb` is what TMDB says whatever the owner decided, `choice` what the NFO follows (`tmdb`, `none` or `custom` with `name`), `effective` the collection the movie is filed under. `parts` lists the movies of the TMDB collection with the ones the library holds (`present`); `customNames` are the owner’s own collections of the library, for shortcuts. */
                            collectionChoice: {
                                tmdb: {
                                    id: number;
                                    name: string;
                                } | null;
                                /** @enum {string} */
                                choice: "tmdb" | "none" | "custom";
                                name: string | null;
                                effective: {
                                    /** @description Stable id of the collection in a library: `t:<TMDB id>` or `c:<name>`. */
                                    key: string;
                                    name: string;
                                    /** @description The owner’s own collection: it has no TMDB id. */
                                    custom: boolean;
                                    /** @description Movies of it that the library holds. */
                                    held: number;
                                    /** @description Movies TMDB lists in it; `null` for a custom collection, or when unknown. */
                                    total: number | null;
                                } | null;
                                parts: {
                                    id: number;
                                    title: string;
                                    year: number | null;
                                    present: boolean;
                                }[];
                                customNames: string[];
                            } | null;
                            overview: string | null;
                            runtime: number | null;
                            genres: string[];
                            posterPath: string | null;
                            backdropPath: string | null;
                            logoPath: string | null;
                            /** @description Which images the profile writes are on the disk (`poster`, `fanart`, `logo`), `null` when they cannot be changed from here: the profile writes none, or the work has no folder of its own. `GET .../images` can be asked only when this is not `null`. */
                            images: {
                                poster: boolean;
                                fanart: boolean;
                                logo: boolean;
                            } | null;
                            file: {
                                video: string | null;
                                audio: string | null;
                                /** @enum {string|null} */
                                hdr: "dolby-vision" | "hdr10-plus" | "hdr10" | "hlg" | null;
                                audioLanguages: string[];
                                subtitleLanguages: string[];
                                size: number;
                            } | null;
                            /** @description The files of the movie (this one alone for anything else), each read as `file` is. */
                            versions: {
                                /** @description What `POST /api/libraries/{id}/execute` takes. */
                                id: string;
                                path: string;
                                /** @enum {string} */
                                state: "review" | "rename" | "unrecognized" | "incomplete" | "ok";
                                /** @description Read in the file name, e.g. `1080p`. */
                                resolution: string | null;
                                /** @description The NFO of this file is there: `<file>.nfo` for an episode, the shared `movie.nfo` for a movie (the same for every version). `null`: the profile writes none. */
                                nfo: boolean | null;
                                /** @description To validate or change the match. */
                                entryId: string | null;
                                /** @description What the snapshot knows of the file: a list never reads the disk, so `null` until the background probe got to it (the page of the item reads it at once). */
                                file: {
                                    video: string | null;
                                    audio: string | null;
                                    /** @enum {string|null} */
                                    hdr: "dolby-vision" | "hdr10-plus" | "hdr10" | "hlg" | null;
                                    audioLanguages: string[];
                                    subtitleLanguages: string[];
                                    size: number;
                                } | null;
                            }[];
                            /** @description The NFO the profile wants for this item, checked on the disk now: the shared `movie.nfo` of a movie, the `<file>.nfo` of an episode. Empty when it writes none. */
                            nfoFiles: {
                                path: string;
                                present: boolean;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/collection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change the collection of movies and write their NFO again
         * @description The owner’s choice for each movie: `tmdb` (the one TMDB names, the default: it clears any override), `none`, or `custom` with a `name`. The choice is kept apart from TMDB’s record, so a refresh does not overwrite it. Only the `<set>` of the NFO changes, and nothing moves: the NFO is generated again as a whole, so one that was edited since is left as it is (`kept`). The batch can be undone from the history. 409 `library.no-collections` for a library that writes no NFO.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description The `id`s of the movies in `GET /api/libraries/{id}/items`. */
                        items: string[];
                        /** @enum {string} */
                        choice: "tmdb" | "none" | "custom";
                        name?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            movies: number;
                            /** @description NFO written again. */
                            rewritten: number;
                            /** @description NFO that already said it. */
                            unchanged: number;
                            /** @description NFO edited since: left as they are. */
                            kept: number;
                            /** @description NFO not on the disk yet. */
                            missing: number;
                            /** @description To undo, when any was written. */
                            batchId: string | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The shows of a series library
         * @description One row per work (files nobody identified are not shows: they are in `GET /api/libraries/{id}/items`, filtered by state). `missing` is the number of aired episodes no file holds, as last counted: `null` until it was (it is counted on opening a show, and in the background when no job runs), never by this request. `missing=true` keeps the shows that lack some; `incomplete=true` those lacking a file the profile writes for the show or a season (`tvshow.nfo`, an image: see `nfo`, `poster`, `fanart`, `logo`); `state` keeps the shows holding a file of that state, as `GET /api/libraries/{id}/items` filters. 409 `library.not-series` for a movie library.
         */
        get: {
            parameters: {
                query?: {
                    q?: string;
                    missing?: boolean;
                    incomplete?: boolean;
                    state?: "review" | "rename" | "unrecognized" | "missing-nfo" | "missing-artwork" | "multi-version" | "incomplete-versions";
                    limit?: number;
                    offset?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            total: number;
                            items: {
                                tmdbId: number;
                                title: string | null;
                                year: number | null;
                                /** @description Seasons the library holds files of. */
                                seasons: number;
                                /** @description Distinct episodes the files hold (a range counts each, a version none twice). */
                                episodes: number;
                                /** @description Each version of the files, from the largest picture down, with the episodes it holds out of those held (`total`). A file whose name says no size is a version only beside another of its episode (`resolution` `null`). */
                                versions: {
                                    resolution: string | null;
                                    covered: number;
                                    total: number;
                                }[];
                                /** @description Episodes with a version whose own NFO is missing. */
                                episodesLackingNfo: number;
                                /** @description Aired episodes no file holds, as last counted; `null` until it was. */
                                missing: number | null;
                                /** @description Episodes whose video is to rename. */
                                rename: number;
                                /** @description Episodes lacking an NFO or an image of their own. */
                                refresh: number;
                                /** @description `tvshow.nfo` is on the disk. `null`: the profile does not write it, or no scan or change has looked yet. */
                                nfo: boolean | null;
                                /** @description The show poster is on the disk. `null`: the profile does not write it, or no scan or change has looked yet. */
                                poster: boolean | null;
                                /** @description The show fanart is on the disk. `null`: the profile does not write it, or no scan or change has looked yet. */
                                fanart: boolean | null;
                                /** @description The show logo is on the disk. `null`: the profile does not write it, or no scan or change has looked yet. */
                                logo: boolean | null;
                                /** @description Show images the profile writes that TMDB has none of (and the disk neither): not missing, the list shows them as unavailable. */
                                unavailable: ("poster" | "fanart" | "logo")[];
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A show, season by season, with the episodes it lacks
         * @description What the library holds of the show against what the provider lists (cached, one request per season at most). An episode is `present` (`item` is its file; a multi-episode file serves each of its episodes), `missing` (aired, no file), `unaired` (not out, or no date: never counted), or `extra` (a file the provider does not know). Season 0 (specials) lists what is there and is never missing. Counting here refreshes the number `GET /api/libraries/{id}/shows` gives. When the provider cannot be asked, `determined` is `false` and the seasons list only the files.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            tmdbId: number;
                            title: string | null;
                            year: number | null;
                            overview: string | null;
                            genres: string[];
                            posterPath: string | null;
                            backdropPath: string | null;
                            logoPath: string | null;
                            /** @description Which images the profile writes are on the disk (`poster`, `fanart`, `logo`), `null` when they cannot be changed from here: the profile writes none, or the work has no folder of its own. `GET .../images` can be asked only when this is not `null`. */
                            images: {
                                poster: boolean;
                                fanart: boolean;
                                logo: boolean;
                            } | null;
                            /** @description The provider’s wording. */
                            status: string | null;
                            determined: boolean;
                            missing: number | null;
                            /** @description Episodes the provider lists, specials left out: the total `missing` is read against. */
                            known: number | null;
                            seasons: {
                                /** @description 0 is the specials. */
                                season: number;
                                /** @description Every version of the show against the episodes of this season: one absent from it holds none. */
                                versions: {
                                    resolution: string | null;
                                    covered: number;
                                    total: number;
                                }[];
                                nfo: {
                                    expected: number;
                                    present: number;
                                };
                                name: string | null;
                                posterPath: string | null;
                                /** @description The season poster is on the disk. `null`: the profile does not write it, or no scan or change has looked yet. */
                                poster: boolean | null;
                                /** @description Always 0 for the specials. */
                                missing: number;
                                episodes: {
                                    season: number;
                                    episode: number;
                                    title: string | null;
                                    airDate: string | null;
                                    /** @description The provider’s synopsis. */
                                    overview: string | null;
                                    /** @description Minutes. */
                                    runtime: number | null;
                                    /** @enum {string} */
                                    state: "present" | "missing" | "unaired" | "extra";
                                    /** @description The files that hold it, one per version; none when it is missing. */
                                    versions: {
                                        /** @description Stable for a path: `GET /api/libraries/{id}/items/{itemId}`. */
                                        id: string;
                                        path: string;
                                        /** @enum {string} */
                                        state: "review" | "rename" | "unrecognized" | "incomplete" | "ok";
                                        /** @enum {string|null} */
                                        kind: "movie" | "series" | null;
                                        /** @description The official title; the file name’s when nothing matched. */
                                        title: string | null;
                                        year: number | null;
                                        tmdbId: number | null;
                                        /** @description Series only. */
                                        season: number | null;
                                        /** @description Series only: the first episode. */
                                        episode: number | null;
                                        /** @description The last episode of a file holding several; `null` for a single one. */
                                        episodeEnd: number | null;
                                        /** @description Read in the file name, e.g. `1080p`. */
                                        resolution: string | null;
                                        /** @description `null`: the profile writes none, or it cannot be told. */
                                        nfo: boolean | null;
                                        poster: boolean | null;
                                        fanart: boolean | null;
                                        logo: boolean | null;
                                        /** @description An episode’s own image, `<file>-thumb.jpg`; `null` for any other file. */
                                        thumb: boolean | null;
                                        /** @description Movie images the profile writes that TMDB has none of (and the disk neither): their flag above reads as there, since nothing is missing, but the list shows them as unavailable. */
                                        unavailable: ("poster" | "fanart" | "logo")[];
                                        /** @description To validate or change the match. */
                                        entryId: string | null;
                                        /** @description The folder the file came in: files sharing it (and its `cluster`) are validated together. Filled by the list of items only. */
                                        release: string | null;
                                        /** @description Which series of the release: 0 the main one, 1 and up the others. */
                                        cluster: number | null;
                                        /** @description Files a validation of this one settles: itself and the rest of its series in the release. */
                                        releaseFiles: number | null;
                                    }[];
                                    nfo: {
                                        expected: number;
                                        present: number;
                                    };
                                }[];
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rename or complete a selection of the items of a library
         * @description Runs what the last scan planned for the chosen items (`id` of `GET /api/libraries/{id}/items`): the videos to rename, and the NFO and images missing beside the ones already in place. It writes only what is planned and never overwrites a file. One plan per scan job the items come from, under one batch. With `dryRun` every precondition is checked and nothing is written (200, the report of `POST /api/plans/{id}/execute`, entries being the items’ `entryId`); otherwise the transfers are queued (202) and the batch appears in the history. Items with nothing to do (done, never scanned, unknown) are listed in `skipped`; 409 `library.nothing-to-do` when none is left, 409 `library.transfer-in-progress` when a batch still waiting or running holds one of them. With `version`, the movies chosen are renamed to say their version (`Title (2021) - 2160p`) even when they are already named as the profile wants; the size comes from the file name, and a movie whose name gives none is skipped (409 `library.version-unavailable` when that is all of them). `screenSize` (`1080p`, `2160p`…) names the size when the file name gives none, or corrects it.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        items: string[];
                        dryRun?: boolean;
                        version?: boolean;
                        screenSize?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            batchId: string;
                            dryRun: boolean;
                            items: {
                                entryId: string;
                                results: {
                                    /** @enum {string} */
                                    type: "transfer" | "write-file" | "download";
                                    role: string | null;
                                    mode: string | null;
                                    source: string | null;
                                    destination: string;
                                    /** @enum {string} */
                                    status: "done" | "failed" | "skipped";
                                    error: {
                                        code: string;
                                        params?: {
                                            [key: string]: string | number;
                                        };
                                    } | null;
                                }[];
                            }[];
                            /** @description Items of the selection with nothing to do (already done, or not scanned). */
                            skipped: string[];
                        };
                    };
                };
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            executions: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                                progress?: {
                                    done: number;
                                    total: number;
                                    current: string | null;
                                } | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                startedAt: string | null;
                                /** Format: date-time */
                                finishedAt: string | null;
                                batchId: string | null;
                                summary: {
                                    done: number;
                                    failed: number;
                                } | null;
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                            /** @description Items of the selection with nothing to do (already done, or not scanned). */
                            skipped: string[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/items/{itemId}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The images of a movie
         * @description What the provider offers (`candidates`, in the metadata language, then English, then with no text; only those that can be written under the profile’s name) and what is in place (`current`, `null` when the file is missing). `files` is the name the profile writes, `null` when it writes none: that image cannot be changed (409 `image.not-editable` when none can).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            title: string | null;
                            year: number | null;
                            folder: string;
                            files: {
                                poster: string | null;
                                fanart: string | null;
                                logo: string | null;
                                thumb: string | null;
                            };
                            current: {
                                poster: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                fanart: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                logo: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                thumb: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                            };
                            candidates: {
                                poster: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                fanart: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                logo: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                thumb: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Replaces images of a movie
         * @description Each image is `{ type, source, value }`: `tmdb` with one of the provider’s paths (`candidates`), or `url` with an address. Every image is downloaded before any is written, so a bad one changes nothing. The address must be http or https, a JPEG or a PNG of at most 20 MB, in the format of the file the profile writes, and not on the local network unless the settings allow it (422 `image.url-*`). The file in place is kept and the batch can be undone from the history.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        images: {
                            /** @enum {string} */
                            type: "poster" | "fanart" | "logo" | "thumb";
                            /** @enum {string} */
                            source: "tmdb" | "url";
                            value: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            batchId: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/items/{itemId}/images/{type}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The image in place for a movie */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                    type: "poster" | "fanart" | "logo" | "thumb";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/items/{itemId}/images/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Previews an image given by address for a movie
         * @description Downloads the address as `POST` of the images would (same limits, same refusals, including the format of the file the profile writes for `type`) and answers with what was found, the image as a `data:` address included. Nothing is written or kept.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        type: "poster" | "fanart" | "logo" | "thumb";
                        url: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            format: "jpeg" | "png";
                            width: number;
                            height: number;
                            /** @description Bytes. */
                            size: number;
                            data: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The images of a show
         * @description What the provider offers (`candidates`, in the metadata language, then English, then with no text; only those that can be written under the profile’s name) and what is in place (`current`, `null` when the file is missing). `files` is the name the profile writes, `null` when it writes none: that image cannot be changed (409 `image.not-editable` when none can).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            title: string | null;
                            year: number | null;
                            folder: string;
                            files: {
                                poster: string | null;
                                fanart: string | null;
                                logo: string | null;
                                thumb: string | null;
                            };
                            current: {
                                poster: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                fanart: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                logo: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                thumb: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                            };
                            candidates: {
                                poster: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                fanart: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                logo: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                thumb: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Replaces images of a show
         * @description Each image is `{ type, source, value }`: `tmdb` with one of the provider’s paths (`candidates`), or `url` with an address. Every image is downloaded before any is written, so a bad one changes nothing. The address must be http or https, a JPEG or a PNG of at most 20 MB, in the format of the file the profile writes, and not on the local network unless the settings allow it (422 `image.url-*`). The file in place is kept and the batch can be undone from the history.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        images: {
                            /** @enum {string} */
                            type: "poster" | "fanart" | "logo" | "thumb";
                            /** @enum {string} */
                            source: "tmdb" | "url";
                            value: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            batchId: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}/images/{type}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The image in place for a show */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                    type: "poster" | "fanart" | "logo" | "thumb";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}/images/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Previews an image given by address for a show
         * @description Downloads the address as `POST` of the images would (same limits, same refusals, including the format of the file the profile writes for `type`) and answers with what was found, the image as a `data:` address included. Nothing is written or kept.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        type: "poster" | "fanart" | "logo" | "thumb";
                        url: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            format: "jpeg" | "png";
                            width: number;
                            height: number;
                            /** @description Bytes. */
                            size: number;
                            data: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}/seasons/{season}/episodes/{episode}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The images of an episode (its `thumb`, written for every version)
         * @description What the provider offers (`candidates`, in the metadata language, then English, then with no text; only those that can be written under the profile’s name) and what is in place (`current`, `null` when the file is missing). `files` is the name the profile writes, `null` when it writes none: that image cannot be changed (409 `image.not-editable` when none can).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                    season: number;
                    episode: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            title: string | null;
                            year: number | null;
                            folder: string;
                            files: {
                                poster: string | null;
                                fanart: string | null;
                                logo: string | null;
                                thumb: string | null;
                            };
                            current: {
                                poster: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                fanart: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                logo: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                                thumb: {
                                    size: number;
                                    modified: number;
                                    width: number | null;
                                    height: number | null;
                                    path: string | null;
                                } | null;
                            };
                            candidates: {
                                poster: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                fanart: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                logo: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                                thumb: {
                                    /** @description The provider’s path, for `GET /api/images`. */
                                    path: string;
                                    /** @description ISO 639-1; `null`: no text. */
                                    language: string | null;
                                    width: number;
                                    height: number;
                                    rating: number | null;
                                    votes: number;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Replaces images of an episode (its `thumb`, written for every version)
         * @description Each image is `{ type, source, value }`: `tmdb` with one of the provider’s paths (`candidates`), or `url` with an address. Every image is downloaded before any is written, so a bad one changes nothing. The address must be http or https, a JPEG or a PNG of at most 20 MB, in the format of the file the profile writes, and not on the local network unless the settings allow it (422 `image.url-*`). The file in place is kept and the batch can be undone from the history.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                    season: number;
                    episode: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        images: {
                            /** @enum {string} */
                            type: "poster" | "fanart" | "logo" | "thumb";
                            /** @enum {string} */
                            source: "tmdb" | "url";
                            value: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            batchId: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}/seasons/{season}/episodes/{episode}/images/{type}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The image in place for an episode (its `thumb`, written for every version) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                    season: number;
                    episode: number;
                    type: "poster" | "fanart" | "logo" | "thumb";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/shows/{tmdbId}/seasons/{season}/episodes/{episode}/images/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Previews an image given by address for an episode (its `thumb`, written for every version)
         * @description Downloads the address as `POST` of the images would (same limits, same refusals, including the format of the file the profile writes for `type`) and answers with what was found, the image as a `data:` address included. Nothing is written or kept.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    tmdbId: number;
                    season: number;
                    episode: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        type: "poster" | "fanart" | "logo" | "thumb";
                        url: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            format: "jpeg" | "png";
                            width: number;
                            height: number;
                            /** @description Bytes. */
                            size: number;
                            data: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/watch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Whether any folder is watched */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description At least one library is watched. */
                            enabled: boolean;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/watch/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Look at the watched folders now
         * @description Submits what is there without waiting for it to settle: whoever asks knows it is complete. A file still carrying a download suffix (`.part`, `.!qB`) is left alone. With `all`, starts over: every file is analysed again, except those a job is working on or that already wait in the arrivals (the libraries were emptied, say). 409 `watch.not-configured` when no folder is watched.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        all?: boolean;
                    } | null;
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            submitted: number;
                            /** @description Releases still being written. */
                            pending: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tmdb/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What Kinoshelf sent to TMDB
         * @description Counted by Kinoshelf itself (TMDB reports no quota): requests sent, calls answered by the cache, and failures, per kind of call, over 24 hours, 7 days or 30 days.
         */
        get: {
            parameters: {
                query?: {
                    period?: "24h" | "7d" | "30d";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {unknown} */
                            period: "24h" | "7d" | "30d";
                            totals: {
                                /** @description Requests sent to TMDB that came back (a 404 too). */
                                network: number;
                                /** @description Calls answered by the cache: nothing was sent. */
                                cache: number;
                                /** @description Requests TMDB answered with a 429. */
                                rateLimited: number;
                                /** @description Requests TMDB answered with a 5xx. */
                                serverError: number;
                                /** @description Requests that never got an answer. */
                                unreachable: number;
                                /** @description Requests refused otherwise (a wrong key, a 4xx). */
                                refused: number;
                                /** @description Median time of the requests that came back, to within 12 %. */
                                latencyMs: number | null;
                            };
                            /** @description One per hour (24 h) or per UTC day (7 d, 30 d), oldest first, empty ones too. */
                            slots: {
                                /** Format: date-time */
                                start: string;
                                network: number;
                                cache: number;
                                errors: number;
                            }[];
                            kinds: {
                                /** @enum {unknown} */
                                kind: "search" | "movie" | "series" | "collection" | "season" | "images" | "titles";
                                /** @description Requests sent to TMDB that came back (a 404 too). */
                                network: number;
                                /** @description Calls answered by the cache: nothing was sent. */
                                cache: number;
                                /** @description Requests TMDB answered with a 429. */
                                rateLimited: number;
                                /** @description Requests TMDB answered with a 5xx. */
                                serverError: number;
                                /** @description Requests that never got an answer. */
                                unreachable: number;
                                /** @description Requests refused otherwise (a wrong key, a 4xx). */
                                refused: number;
                                /** @description Median time of the requests that came back, to within 12 %. */
                                latencyMs: number | null;
                            }[];
                            /** @description Since the server started, newest first. */
                            recentErrors: {
                                /** Format: date-time */
                                at: string;
                                /** @enum {unknown} */
                                kind: "search" | "movie" | "series" | "collection" | "season" | "images" | "titles";
                                /** @enum {unknown} */
                                outcome: "rate-limited" | "server-error" | "unreachable" | "refused";
                                status: number | null;
                                path: string;
                            }[];
                            /**
                             * Format: date-time
                             * @description When the server started.
                             */
                            since: string;
                            cache: {
                                entries: number;
                                bytes: number;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tmdb/cache": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Forget the cached TMDB answers
         * @description The next analyses ask TMDB again. Nothing else is touched.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            removed: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The last lines of the server's log
         * @description Read from memory (the last few thousand lines), newest first. Keys, tokens and webhook addresses are wiped before a line is kept. `after` is the `seq` of the newest line a client shows: `newer` then counts the matching lines it does not show yet.
         */
        get: {
            parameters: {
                query?: {
                    /** @description This level and above. */
                    level?: "debug" | "info" | "warn" | "error";
                    component?: "server" | "http" | "scan" | "transfer" | "watcher" | "tmdb" | "notify";
                    q?: string;
                    minutes?: number;
                    limit?: number;
                    after?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Newest first. */
                            entries: {
                                /** @description Grows with each line. */
                                seq: number;
                                /** Format: date-time */
                                time: string;
                                /** @enum {unknown} */
                                level: "debug" | "info" | "warn" | "error";
                                /** @enum {unknown} */
                                component: "server" | "http" | "scan" | "transfer" | "watcher" | "tmdb" | "notify";
                                message: string;
                                /** @description The job the line is about, if any. */
                                job: string | null;
                                /** @description The line's other fields. */
                                data: {
                                    [key: string]: unknown;
                                };
                            }[];
                            /** @description Matching lines newer than `after`; 0 without it. */
                            newer: number;
                            /** @description Lines held in memory. */
                            kept: number;
                            /**
                             * Format: date-time
                             * @description The oldest of them.
                             */
                            since: string | null;
                            /** @description What the log files hold on the disk. */
                            fileBytes: number;
                            /**
                             * @description The level the server logs at now.
                             * @enum {unknown}
                             */
                            level: "debug" | "info" | "warn" | "error";
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/logs/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The log file
         * @description Every line kept on the disk, oldest first, as JSON lines (`kinoshelf.log`). Wiped of secrets like the list.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description application/x-ndjson */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/logs/level": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change the level the server logs at
         * @description Takes effect at once and lasts until the server restarts (then `KINOSHELF_LOG_LEVEL`, or `info`, applies again): `debug` is for finding a problem, not for keeping.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {unknown} */
                        level: "debug" | "info" | "warn" | "error";
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {unknown} */
                            level: "debug" | "info" | "warn" | "error";
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/images/{size}/{file}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A TMDB poster, fetched once and kept
         * @description `file` is a candidate’s `posterPath` without its leading slash. The browser never contacts TMDB.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    size: "w92" | "w154" | "w300" | "w342" | "w500" | "w780";
                    file: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a file or a folder to identify
         * @description Queues the analysis (parse, match, plan) of an absolute path; nothing is written to the disk. With `apply`, the files matched with confidence are then transferred in one batch and the others wait in the validation queue: one call replaces a manual run.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Absolute path; not `/`, `/proc`, `/sys` nor `/dev` (422) */
                        path: string;
                        /** @default false */
                        apply?: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            path: string;
                            libraryId: string | null;
                            /** @enum {string} */
                            status: "queued" | "running" | "done" | "failed";
                            apply: boolean;
                            /** Format: date-time */
                            startedAt: string | null;
                            /** Format: date-time */
                            finishedAt: string | null;
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                            execution: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                                progress?: {
                                    done: number;
                                    total: number;
                                    current: string | null;
                                } | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                startedAt: string | null;
                                /** Format: date-time */
                                finishedAt: string | null;
                                batchId: string | null;
                                summary: {
                                    done: number;
                                    failed: number;
                                } | null;
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            } | null;
                            summary: {
                                compliant: number;
                                "to-rename": number;
                                conflict: number;
                                ambiguous: number;
                                unrecognized: number;
                            } | null;
                            progress: {
                                /** @enum {string} */
                                phase: "discover" | "read" | "identify" | "plan";
                                found: number;
                                done: number;
                                total: number;
                                current: string | null;
                                idleSeconds: number;
                            } | null;
                            transfer?: {
                                done: number;
                                total: number;
                                current: string | null;
                            } | null;
                            settings: {
                                profile: {
                                    /** @enum {string} */
                                    naming: "with-id" | "no-id";
                                    /** @enum {string} */
                                    metadata: "none" | "nfo";
                                };
                                /** @enum {string} */
                                mode: "copy" | "hardlink" | "move";
                                destinationRoot: string | {
                                    movie: string;
                                    series: string;
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A job, with a count of its files per classification once it is done */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            path: string;
                            libraryId: string | null;
                            /** @enum {string} */
                            status: "queued" | "running" | "done" | "failed";
                            apply: boolean;
                            /** Format: date-time */
                            startedAt: string | null;
                            /** Format: date-time */
                            finishedAt: string | null;
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                            execution: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "failed";
                                progress?: {
                                    done: number;
                                    total: number;
                                    current: string | null;
                                } | null;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                startedAt: string | null;
                                /** Format: date-time */
                                finishedAt: string | null;
                                batchId: string | null;
                                summary: {
                                    done: number;
                                    failed: number;
                                } | null;
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            } | null;
                            summary: {
                                compliant: number;
                                "to-rename": number;
                                conflict: number;
                                ambiguous: number;
                                unrecognized: number;
                            } | null;
                            progress: {
                                /** @enum {string} */
                                phase: "discover" | "read" | "identify" | "plan";
                                found: number;
                                done: number;
                                total: number;
                                current: string | null;
                                idleSeconds: number;
                            } | null;
                            transfer?: {
                                done: number;
                                total: number;
                                current: string | null;
                            } | null;
                            settings: {
                                profile: {
                                    /** @enum {string} */
                                    naming: "with-id" | "no-id";
                                    /** @enum {string} */
                                    metadata: "none" | "nfo";
                                };
                                /** @enum {string} */
                                mode: "copy" | "hardlink" | "move";
                                destinationRoot: string | {
                                    movie: string;
                                    series: string;
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/arrivals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Files that wait for a destination or a choice
         * @description What the arrival folders (and paths sent by hand) hold that waits for a human: `review` (candidates to choose from, a conflict, a failed transfer), `unrecognized`, and `ready` (matched with confidence, but the analysis did not transfer it: `apply` is off; `POST /api/plans/{id}/execute` starts it). Each file says where it would go (`destination`) and the libraries it could go to instead. `total` counts every file of the filter, for the badge of the navigation; `limit` and `offset` count releases.
         */
        get: {
            parameters: {
                query?: {
                    state?: "ready" | "review" | "unrecognized";
                    limit?: number;
                    offset?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Files of this filter, for the badge. Paging counts releases. */
                            total: number;
                            sources: {
                                id: string;
                                name: string;
                                path: string;
                            }[];
                            items: {
                                /**
                                 * Format: uuid
                                 * @description The entry: `/api/entries/{id}/…`.
                                 */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                path: string;
                                /** @description The name of the file. */
                                file: string;
                                /** @description The folder (or file) it came in. A series of that folder is validated as one: the files sharing `release` and `cluster`. */
                                release: string | null;
                                /** @description Which series of the folder: 0 is the main one, 1 and up are the others. */
                                cluster: number;
                                /** @description Another series than the main one of the folder (`cluster` above 0). */
                                detached: boolean;
                                /** @enum {string} */
                                state: "ready" | "review" | "unrecognized";
                                /** @enum {string|null} */
                                kind: "movie" | "series" | null;
                                resolution: string | null;
                                title: string | null;
                                year: number | null;
                                sourceId: string | null;
                                destination: {
                                    libraryId: string | null;
                                };
                                destinationOptions: {
                                    id: string;
                                    name: string;
                                }[];
                                reason: string | null;
                                candidates: {
                                    /** @enum {string} */
                                    kind: "movie" | "series";
                                    id: {
                                        /** @enum {string} */
                                        provider: "tmdb";
                                        id: number;
                                    };
                                    title: string;
                                    originalTitle: string;
                                    year?: number;
                                    posterPath?: string;
                                    score: number;
                                }[];
                                conflicts: {
                                    reason: string;
                                    path: string;
                                    detail: {
                                        code: string;
                                        params?: {
                                            [key: string]: string | number;
                                        };
                                    } | null;
                                }[];
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entries/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One file, as `GET /api/arrivals` shows it
         * @description For a file that is not in an arrival folder (a library organized in place, a path sent by hand), whose candidates and destinations are needed to settle it.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * Format: uuid
                             * @description The entry: `/api/entries/{id}/…`.
                             */
                            id: string;
                            /** Format: uuid */
                            jobId: string;
                            path: string;
                            /** @description The name of the file. */
                            file: string;
                            /** @description The folder (or file) it came in. A series of that folder is validated as one: the files sharing `release` and `cluster`. */
                            release: string | null;
                            /** @description Which series of the folder: 0 is the main one, 1 and up are the others. */
                            cluster: number;
                            /** @description Another series than the main one of the folder (`cluster` above 0). */
                            detached: boolean;
                            /** @enum {string} */
                            state: "ready" | "review" | "unrecognized";
                            /** @enum {string|null} */
                            kind: "movie" | "series" | null;
                            resolution: string | null;
                            title: string | null;
                            year: number | null;
                            sourceId: string | null;
                            destination: {
                                libraryId: string | null;
                            };
                            destinationOptions: {
                                id: string;
                                name: string;
                            }[];
                            reason: string | null;
                            candidates: {
                                /** @enum {string} */
                                kind: "movie" | "series";
                                id: {
                                    /** @enum {string} */
                                    provider: "tmdb";
                                    id: number;
                                };
                                title: string;
                                originalTitle: string;
                                year?: number;
                                posterPath?: string;
                                score: number;
                            }[];
                            conflicts: {
                                reason: string;
                                path: string;
                                detail: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search TMDB by hand */
        get: {
            parameters: {
                query: {
                    query: string;
                    year?: number;
                    kind?: "movie" | "series";
                    language?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            kind: "movie" | "series";
                            id: {
                                /** @enum {string} */
                                provider: "tmdb";
                                id: number;
                            };
                            title: string;
                            originalTitle: string;
                            year?: number;
                            posterPath?: string;
                            alternativeTitles?: string[];
                            overview?: string;
                            popularity?: number;
                            countries?: string[];
                        }[];
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entries/{id}/match": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Where a validation is
         * @description The last validation started for the file: `running` with how many files have their metadata loaded, `done` with the file and its `followers`, or `failed` with the cause. It lives in the server's memory: 404 once the server restarted (the file is simply still waiting). The `progress` event says when to read it again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "running" | "done" | "failed";
                            done?: number;
                            total?: number;
                            current?: string | null;
                            followers?: string[];
                            entry?: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                jobId: string;
                                path: string;
                                /** @enum {string} */
                                classification: "compliant" | "to-rename" | "conflict" | "ambiguous" | "unrecognized";
                                /** @enum {string|null} */
                                resolution: "done" | "failed" | "ignored" | null;
                                parsed: {
                                    kind: string;
                                    title?: string;
                                    year?: number;
                                    season?: number;
                                    episodes: number[];
                                };
                                reason: string | null;
                                candidates: {
                                    /** @enum {string} */
                                    kind: "movie" | "series";
                                    id: {
                                        /** @enum {string} */
                                        provider: "tmdb";
                                        id: number;
                                    };
                                    title: string;
                                    originalTitle: string;
                                    year?: number;
                                    posterPath?: string;
                                    score: number;
                                }[];
                                destination: string | null;
                                conflicts: {
                                    reason: string;
                                    path: string;
                                    detail: {
                                        code: string;
                                        params?: {
                                            [key: string]: string | number;
                                        };
                                    } | null;
                                }[];
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                                batchId: string | null;
                                release: string | null;
                                cluster: number;
                                detached: boolean;
                            };
                            error?: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * Validate a match
         * @description Starts planning the file with a candidate returned by `GET /api/search`; it overrides the score. The answer is 202 at once: the work takes as long as the release is long, and `GET /api/entries/{id}/match` tells where it is and how it ended (the file `to-rename`, or in `conflict` if its target cannot be used). For a series, the other episodes of the same release follow the choice (the ones of the same `cluster`) and are planned together; `followers` lists them. 409 when the release is already being validated or a transfer holds one of its files. `libraryId` sends the file to that library (of the work's kind) rather than to the default one, for this file only. `screenSize` (`2160p`…) names the file's quality when its name says none, and wins over what the name says; it is for this file only.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        kind: "movie" | "series";
                        id: {
                            /** @enum {string} */
                            provider: "tmdb";
                            id: number;
                        };
                        title: string;
                        originalTitle?: string;
                        year?: number;
                        posterPath?: string;
                        alternativeTitles?: string[];
                        overview?: string;
                        popularity?: number;
                        countries?: string[];
                        libraryId?: string;
                        screenSize?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entries/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Where a file would go with a candidate
         * @description Plans the file like `match` does, and records nothing: the destination, and the conflicts that would send it back to the queue. `libraryId` previews the destination in that library instead of the default one.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        kind: "movie" | "series";
                        id: {
                            /** @enum {string} */
                            provider: "tmdb";
                            id: number;
                        };
                        title: string;
                        originalTitle?: string;
                        year?: number;
                        posterPath?: string;
                        alternativeTitles?: string[];
                        overview?: string;
                        popularity?: number;
                        countries?: string[];
                        libraryId?: string;
                        screenSize?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            destination: string | null;
                            conflicts: {
                                reason: string;
                                path: string;
                                detail: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                            /** @description The folder of the series when several episodes of a release go along with this one: the destination alone would stand for one of them. */
                            folder: string | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/entries/{id}/ignore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a file aside
         * @description The rest of its release goes with it.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            jobId: string;
                            path: string;
                            /** @enum {string} */
                            classification: "compliant" | "to-rename" | "conflict" | "ambiguous" | "unrecognized";
                            /** @enum {string|null} */
                            resolution: "done" | "failed" | "ignored" | null;
                            parsed: {
                                kind: string;
                                title?: string;
                                year?: number;
                                season?: number;
                                episodes: number[];
                            };
                            reason: string | null;
                            candidates: {
                                /** @enum {string} */
                                kind: "movie" | "series";
                                id: {
                                    /** @enum {string} */
                                    provider: "tmdb";
                                    id: number;
                                };
                                title: string;
                                originalTitle: string;
                                year?: number;
                                posterPath?: string;
                                score: number;
                            }[];
                            destination: string | null;
                            conflicts: {
                                reason: string;
                                path: string;
                                detail: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                            batchId: string | null;
                            release: string | null;
                            cluster: number;
                            detached: boolean;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plans/{id}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Execute the plan of a job
         * @description The plan of a job is the set of its matched files not transferred yet; its id is the job's. The transfer is queued (202) and its batch shows in the history. Transfers run one at a time: a request made while another is queued or running waits its turn, but files another transfer already holds, or whose release is being validated, are left out: 409 `queue.entry-held` when none is left. A destination that exists is never overwritten, and hardlink never falls back to copy.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Only these files */
                        entries?: string[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            jobId: string;
                            /** @enum {string} */
                            status: "queued" | "running" | "done" | "failed";
                            progress?: {
                                done: number;
                                total: number;
                                current: string | null;
                            } | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            startedAt: string | null;
                            /** Format: date-time */
                            finishedAt: string | null;
                            batchId: string | null;
                            summary: {
                                done: number;
                                failed: number;
                            } | null;
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Batches and jobs in one list, newest first
         * @description A batch is a line of its own (the CLI makes some too, without a job); a job is one only when it has no batch yet: still waiting, running, or failed. A job that finished and moved nothing is `routine`: left out unless `all` is set, and never deleted by that.
         */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    offset?: number;
                    all?: boolean;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Lines of the chosen view, before paging. */
                            total: number;
                            items: {
                                /** @description `GET /api/batches/{id}` for a `batch`, `GET /api/jobs/{id}` for a `job`. */
                                id: string;
                                /** @enum {string} */
                                kind: "batch" | "job";
                                /** Format: date-time */
                                at: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "done" | "undone" | "failed";
                                /** @description What was submitted; absent for the CLI. */
                                path: string | null;
                                operations: number;
                                failed: number;
                                modes: ("copy" | "hardlink" | "move")[];
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                                /** @description A job that finished and moved nothing: only listed with `all`, never deleted by it. */
                                routine: boolean;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A batch and each of its operations */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            /** Format: date-time */
                            at: string;
                            /**
                             * @description `queued`/`running`: its transfer is not over. `failed`: nothing was transferred, so there is nothing to undo.
                             * @enum {string}
                             */
                            status: "queued" | "running" | "done" | "undone" | "failed";
                            /** @description Transfers recorded in the journal. */
                            operations: number;
                            modes: ("copy" | "hardlink" | "move")[];
                            /** @description Files that did not go through. */
                            failed: number;
                            /** @description The job that made the batch; absent for a batch made by the CLI. */
                            origin: {
                                jobId: string;
                                path: string;
                            } | null;
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            } | null;
                            extras: {
                                /** @enum {string} */
                                kind: "generated" | "downloaded" | "replaced";
                                destination: string;
                            }[];
                            items: {
                                source: string;
                                destination: string | null;
                                /** @enum {string} */
                                mode: "copy" | "hardlink" | "move";
                                /** @enum {string} */
                                status: "done" | "undone" | "failed";
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/batches/{id}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Undo a batch
         * @description Any batch not undone yet can be, not only the last (a move goes back where it came from). Each file is checked as it is now: whatever a later batch moved on or took the place of is skipped and reported, never forced.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @default false */
                        dryRun?: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            batchId: string;
                            dryRun: boolean;
                            entries: {
                                source: string;
                                destination: string;
                                /** @enum {string} */
                                mode: "copy" | "hardlink" | "move";
                                /** @enum {string} */
                                status: "undone" | "skipped" | "failed";
                                error: {
                                    code: string;
                                    params?: {
                                        [key: string]: string | number;
                                    };
                                } | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a test notification to every target
         * @description Reaches each webhook, and checks that Plex and Jellyfin answer and accept their key, whatever the events a webhook listens to. Nothing is refreshed.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            target: string;
                            /** @enum {string} */
                            kind: "webhook" | "plex" | "jellyfin";
                            ok: boolean;
                            status?: number;
                            error?: string;
                        }[];
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                params?: {
                                    [key: string]: string | number;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
