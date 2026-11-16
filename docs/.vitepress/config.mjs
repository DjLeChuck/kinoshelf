// The documentation site (VitePress). The pages are plain Markdown that GitHub renders too; this file
// only adds the navigation. `DOCS_BASE` is the path the site is served under: `/kinoshelf/` on GitHub
// Pages (set by the workflow), `/` for `make docs-dev` and `make docs-build`.
import { defineConfig } from 'vitepress';

const REPOSITORY = 'https://github.com/DjLeChuck/kinoshelf';

// Pages are numbered in reading order on disk; the site's addresses do without the numbers.
const PAGES = {
  '0-installation.md': 'installation.md',
  '1-web-ui.md': 'web-ui.md',
  '2-libraries.md': 'libraries.md',
  '3-system.md': 'system.md',
  '4-getting-downloads-in.md': 'getting-downloads-in.md',
  '5-output-options.md': 'output-options.md',
  '6-configuration.md': 'configuration.md',
  '7-cli.md': 'cli.md',
  '8-api.md': 'api.md',
  '9-development.md': 'development.md',
};

export default defineConfig({
  title: 'Kinoshelf',
  description:
    'Identify the video files already on your disk, rename them for Plex or Jellyfin and write their metadata.',
  lang: 'en-US',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  lastUpdated: true,
  rewrites: PAGES,
  // A broken link fails the build, which is the point of building it in CI. Only the addresses of
  // the local test servers in the development guide are not checked.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],
  themeConfig: {
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: 'Kinoshelf' },
    siteTitle: false,
    search: { provider: 'local' },
    nav: [
      { text: 'Get started', link: '/installation' },
      { text: 'Reference', link: '/configuration' },
    ],
    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Installation', link: '/installation' },
          { text: 'Concepts and web UI', link: '/web-ui' },
        ],
      },
      {
        text: 'Using Kinoshelf',
        items: [
          { text: 'Libraries', link: '/libraries' },
          { text: 'System', link: '/system' },
          { text: 'Getting downloads in', link: '/getting-downloads-in' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Output options', link: '/output-options' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Command line', link: '/cli' },
          { text: 'REST API', link: '/api' },
        ],
      },
      { text: 'Contributing', items: [{ text: 'Development', link: '/development' }] },
    ],
    socialLinks: [{ icon: 'github', link: REPOSITORY }],
    editLink: { pattern: `${REPOSITORY}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: {
      message: 'Released under the MIT license. Not endorsed or certified by TMDB.',
    },
  },
});
