# Olai documentation site

Docusaurus 3.10.2, classic preset, TypeScript config. It is a self-contained project: it has its
own `package.json` and lockfile and is not part of the root npm workspace.

```bash
cd docs/site
npm install
npm run start    # serves on http://localhost:3001, so it never collides with the app on 3000
npm run build    # static output in docs/site/build
npm run serve    # serves the built output on 3001
```

Notes for anyone editing it:

- The docs plugin is mounted at the site root (`routeBasePath: '/'`), so `docs/index.md` is the
  home page and there is no separate landing page. The blog plugin is off.
- Diagrams are mermaid code fences. They need `@docusaurus/theme-mermaid` and
  `markdown.mermaid: true`, both set in `docusaurus.config.ts`. Without them they render as raw
  code.
- `markdown.format` is `detect`, so `.md` files are plain markdown. Curly braces and angle
  brackets in response shapes are safe to write.
- Colours and the one motif, a filled amber square, live in `src/css/custom.css`. Dark mode is
  the default.
- House style: no em-dashes anywhere. Check with
  `grep -rn $'\xe2\x80\x94' docs src docusaurus.config.ts` before committing.
