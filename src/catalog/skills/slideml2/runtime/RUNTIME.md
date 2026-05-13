# SlideML2 Runtime

This directory is bundled with the SlideML2 skill so another agent can run the
renderer and authoring loop without the full Cowork repository.

## Install

Runtime dependencies are bundled into `runtime/dist/index.js`, so
agent-facing CLI commands can run immediately with Node.js without
`npm install`. Run the commands from the deck workspace; omitted `--deck`
defaults to `./deck.json`.

```bash
node /path/to/slideml2/runtime/bin/slideml2.js init-deck deck-init.json
node /path/to/slideml2/runtime/bin/slideml2.js add-slide slide-01.json
node /path/to/slideml2/runtime/bin/slideml2.js insert-slide 1 slide-insert.json
node /path/to/slideml2/runtime/bin/slideml2.js set-deck deck-theme.json
node /path/to/slideml2/runtime/bin/slideml2.js validate
node /path/to/slideml2/runtime/bin/slideml2.js render --out deck.pptx
```

This package is runtime-only: it intentionally omits TypeScript source, tests,
examples, development scripts, and node_modules. Rebuilds must happen from the
upstream SlideML2 repository, then a fresh bundled `runtime/dist/index.js` can
be packaged again.

## Agent-Facing CLI

The skill exposes one command interface: `node bin/slideml2.js <command>
[args]`. Do not expose npm scripts, TypeScript handlers, or tool adapters as
separate agent commands.

Minimal content files:

```json
{ "title": "Deck title", "size": "16x9", "theme": "default" }
```

```json
{ "id": "cover", "title": "Deck title", "children": [] }
```

Do not write a complete deck JSON and jump straight to final PPTX generation
for normal deck creation. Use `init-deck` and per-slide `add-slide` /
`insert-slide` / `set-slide` so validation can reject bad slides before they
enter the source deck. Use `set-deck` for theme/config changes that preserve
slides; `reset-deck` intentionally deletes existing slides.
