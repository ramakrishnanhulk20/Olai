import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'index',
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: ['getting-started/quick-start', 'getting-started/first-question'],
    },
    {
      type: 'category',
      label: 'Concepts',
      collapsed: false,
      items: [
        'concepts/how-it-works',
        'concepts/why-binance-agent-os',
        'concepts/trust-model',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/write-a-rulebook',
        'guides/ask-a-question',
        'guides/approve-or-reject',
        'guides/read-the-ledger',
        'guides/kill-switch',
        'guides/dry-run-versus-live',
      ],
    },
    {
      type: 'category',
      label: 'Developers',
      collapsed: false,
      items: [
        'developers/architecture',
        'developers/owner-api',
        'developers/x402-buyer',
        'developers/mcp-client',
        'developers/ledger',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      collapsed: false,
      items: ['security/overview', 'security/threat-model', 'security/audits'],
    },
    'faq',
  ],
};

export default sidebars;
