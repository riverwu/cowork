# SlideML2 Skill Package

Version: 1.0.32

Use this skill whenever the user asks to create, edit, render, review, or export slide decks, presentations, PPT, PPTX, or SlideML2 decks. This skill is the component reference for Cowork's SlideML2 deck tools.

## Install

Unzip this archive so the target agent has a skill directory like:

```
slideml2/
  SKILL.md
  business.md
  LICENSE.txt
  manifest.json
  runtime/
    package.json
    dist/
    RUNTIME.md
    bin/slideml2.js
```

For Codex-style local skill installs, place that `slideml2` directory under
the agent's skills directory, for example `$CODEX_HOME/skills/slideml2`.

## Runtime

The `runtime/` directory is a standalone executable SlideML2 package. It
includes bundled compiled JavaScript under `runtime/dist` and the CLI
entrypoint below. It intentionally does not include TypeScript source, tests,
examples, development scripts, or node_modules.

After unzipping, normal deck authoring runs directly with Node.js; do not run
`npm install` for ordinary use.

```bash
export SLIDEML2_SKILL_DIR=/path/to/slideml2
mkdir -p /path/to/deck-workdir
cd /path/to/deck-workdir
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" init-deck deck-init.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" add-slide slide-01.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" insert-slide 1 slide-insert.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" set-deck deck-theme.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" render --out deck.pptx
```

All CLI commands run from the deck workspace. If `--deck` is omitted, the CLI
reads and writes `./deck.json` in that workspace.

Supported agent-facing commands are:

- `init-deck`
- `reset-deck`
- `set-deck`
- `list-slides`
- `show-deck`
- `add-slide`
- `insert-slide`
- `set-slide`
- `delete-slide`
- `diagnose-slide`
- `validate`
- `render`

Do not call TypeScript handlers, npm scripts, or tool adapters as the agent
interface. Rebuilds must happen from the upstream SlideML2 repository; this
install package is runtime-only.
