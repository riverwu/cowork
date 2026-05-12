# SlideML2 Runtime

This directory is bundled with the SlideML2 skill so another agent can run the
renderer and authoring loop without the full Cowork repository.

## Install

Runtime dependencies are bundled into `runtime/dist/index.js`, so
agent-facing CLI commands can run immediately with Node.js without
`npm install`. Run the commands from the deck workspace; omitted `deckPath`
defaults to `./deck.json`.

```bash
node /path/to/slideml2/runtime/bin/slideml2.js create-deck create-deck.json
node /path/to/slideml2/runtime/bin/slideml2.js read-deck read-deck.json
node /path/to/slideml2/runtime/bin/slideml2.js replace-slide replace-slide-01.json
node /path/to/slideml2/runtime/bin/slideml2.js validate-render validate-render.json
```

This package is runtime-only: it intentionally omits TypeScript source, tests,
examples, development scripts, and node_modules. Rebuilds must happen from the
upstream SlideML2 repository, then a fresh bundled `runtime/dist/index.js` can
be packaged again.

## Agent-Facing CLI

The skill exposes one command interface: `node bin/slideml2.js <command>
<args.json>`. Do not expose npm scripts, TypeScript handlers, or tool adapters
as separate agent commands.

Minimal argument files:

```json
{ "title": "Deck title", "size": "16x9", "theme": "default" }
```

```json
{ "slideId": 0, "slide": { "id": "cover", "title": "Deck title", "children": [] } }
```

```json
{ "render": true, "outputPath": "deck.pptx" }
```

Do not write a complete deck JSON and jump straight to final PPTX generation
for normal deck creation. Use `create-deck` and per-slide `replace-slide` so
validation can reject bad slides before they enter the source deck.
