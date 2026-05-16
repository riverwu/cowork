# SlideML2 Skill Package

Version: 1.0.54

Generate, edit, and validate PowerPoint (.pptx) decks from prompts, notes, markdown, CSV/JSON data, or research/business documents. Use whenever the user asks for a slide deck, presentation, PPT, PPTX, demo slides, 幻灯片, 演示文稿, 投影, 汇报, or any finished deck file as output. The skill drives the SlideML2 CLI toolchain with per-slide validation and emits a real `.pptx` plus a render-tree sidecar — not screenshots or HTML approximations.

## Install

Unzip this archive so the target agent has a skill directory like:

```
slideml2/
  SKILL.md
  planning-template.md
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
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" set-deck deck-theme.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-slide slides/01-cover.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-manifest manifest.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" compose manifest.json --out build/deck.pptx
```

All CLI commands run from the deck workspace. If `--deck` is omitted, the CLI
reads and writes `./deck-config.json` in that workspace.

Supported agent-facing commands are:

- `init-deck`
- `set-deck`
- `validate-slide`
- `validate-manifest`
- `compose`

Do not call TypeScript handlers, npm scripts, or tool adapters as the agent
interface. Rebuilds must happen from the upstream SlideML2 repository; this
install package is runtime-only.
