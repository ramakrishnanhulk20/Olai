import type * as Preset from '@docusaurus/preset-classic';
import type {Config} from '@docusaurus/types';
import {themes as prismThemes} from 'prism-react-renderer';

const config: Config = {
  title: 'Olai',
  tagline:
    "An analyst agent that buys its own market intelligence a cent at a time from its Binance wallet, trades on the owner's Binance sub-account only inside a written rulebook, and can prove what every cent and every order was for.",
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://olai-docs.example.com',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Diagrams are written as mermaid code fences in ARCHITECTURE.md and copied
  // here. Without the theme below plus this flag they render as raw code.
  markdown: {
    // Plain markdown for .md, MDX only for .mdx. Response shapes such as
    // { ok, dryRun } appear all over these pages and MDX would read them as code.
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // The docs are the whole site. There is no marketing page here.
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Olai',
      logo: {
        alt: 'Olai',
        src: 'img/olai-mark.svg',
      },
      items: [
        {to: '/getting-started/quick-start', label: 'Get started', position: 'left'},
        {to: '/developers/architecture', label: 'Developers', position: 'left'},
        {to: '/security/overview', label: 'Security', position: 'left'},
        {to: '/faq', label: 'FAQ', position: 'left'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Start',
          items: [
            {label: 'Quick start', to: '/getting-started/quick-start'},
            {label: 'First question', to: '/getting-started/first-question'},
            {label: 'Dry run versus live', to: '/guides/dry-run-versus-live'},
          ],
        },
        {
          title: 'Understand',
          items: [
            {label: 'How it works', to: '/concepts/how-it-works'},
            {label: 'Trust model', to: '/concepts/trust-model'},
            {label: 'Why Binance Agent OS', to: '/concepts/why-binance-agent-os'},
          ],
        },
        {
          title: 'Build',
          items: [
            {label: 'Architecture', to: '/developers/architecture'},
            {label: 'Owner API', to: '/developers/owner-api'},
            {label: 'Threat model', to: '/security/threat-model'},
          ],
        },
      ],
      copyright: `Olai. Documentation built with Docusaurus. ${new Date().getFullYear()}.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.oceanicNext,
      additionalLanguages: ['bash', 'json', 'sql'],
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
