---
name: browser-use
type: skill
version: 1.0.0
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, or extract information from web pages.
allowed-tools: Bash(browser-use:*)
---

# Browser Automation with browser-use CLI

The `browser-use` command provides fast, persistent browser automation. A background daemon keeps the browser open across commands, giving about 50ms latency per call.

## Prerequisites

```bash
browser-use doctor    # Verify installation
```

In Cowork, if `browser-use` is not available on `PATH`, run the same CLI through `uvx`:

```bash
uvx --with python-socks --from "browser-use[cli]" browser-use doctor
uvx --with python-socks --from "browser-use[cli]" browser-use open https://example.com
```

Use the CLI form for browser automation. Do not look for a browser-use MCP tool unless the user explicitly installs one separately.

For setup details, see https://github.com/browser-use/browser-use/blob/main/browser_use/skill_cli/README.md

## Core Workflow

1. **Navigate**: `browser-use open <url>` launches a headless browser and opens the page.
2. **Inspect**: `browser-use state` returns clickable elements with indices.
3. **Interact**: use indices from state, for example `browser-use click 5` or `browser-use input 3 "text"`.
4. **Verify**: use `browser-use state` or `browser-use screenshot` to confirm.
5. **Repeat**: the browser stays open between commands.

If a command fails, run `browser-use close` first to clear any broken session, then retry.

To use the user's existing Chrome with logins and cookies, run `browser-use connect` first. To use a cloud browser instead, run `browser-use cloud connect` first. After either command, subsequent commands work the same way.

### If `browser-use connect` fails

When `browser-use connect` cannot find a running Chrome with remote debugging, prompt the user with two options:

1. **Use their real Chrome browser**: they need to enable remote debugging first, either by opening `chrome://inspect/#remote-debugging` in Chrome or relaunching Chrome with `--remote-debugging-port=9222`.
2. **Use managed Chromium with their Chrome profile**: run `browser-use profile list`, ask which profile they want, then use `browser-use --profile "ProfileName" open <url>`.

Let the user choose. Do not assume one path over the other.

## Browser Modes

```bash
browser-use open <url>                         # Default: headless Chromium
browser-use --headed open <url>                # Visible window for debugging
browser-use connect                            # Connect to user's Chrome
browser-use cloud connect                      # Cloud browser, requires API key
browser-use --profile "Default" open <url>     # Real Chrome with a specific profile
```

After `connect` or `cloud connect`, all subsequent commands go to that browser.

## Commands

```bash
# Navigation
browser-use open <url>
browser-use back
browser-use scroll down
browser-use scroll up
browser-use tab list
browser-use tab new [url]
browser-use tab switch <index>
browser-use tab close <index> [index...]

# Page state: always run state first to get element indices
browser-use state
browser-use screenshot [path.png]

# Interactions
browser-use click <index>
browser-use click <x> <y>
browser-use type "text"
browser-use input <index> "text"
browser-use input <index> ""
browser-use keys "Enter"
browser-use select <index> "option"
browser-use upload <index> <path>
browser-use hover <index>
browser-use dblclick <index>
browser-use rightclick <index>

# Data extraction
browser-use eval "js code"
browser-use get title
browser-use get html [--selector "h1"]
browser-use get text <index>
browser-use get value <index>
browser-use get attributes <index>
browser-use get bbox <index>

# Wait
browser-use wait selector "css"
browser-use wait text "text"

# Cookies
browser-use cookies get [--url <url>]
browser-use cookies set <name> <value>
browser-use cookies clear [--url <url>]
browser-use cookies export <file>
browser-use cookies import <file>

# Session
browser-use close
browser-use sessions
browser-use close --all
```

For advanced browser control such as CDP, device emulation, and tab activation, see `references/cdp-python.md`.

## Cloud API

```bash
browser-use cloud connect
browser-use cloud login <api-key>
browser-use cloud logout
browser-use cloud v2 GET /browsers
browser-use cloud v2 POST /tasks '{"task":"...","url":"..."}'
browser-use cloud v2 poll <task-id>
browser-use cloud v2 --help
```

`cloud connect` provisions a cloud browser with a persistent profile and prints a live URL. `browser-use close` disconnects and stops the cloud browser.

## Tunnels

```bash
browser-use tunnel <port>
browser-use tunnel list
browser-use tunnel stop <port>
browser-use tunnel stop --all
```

## Profile Management

```bash
browser-use profile list
browser-use profile sync --all
browser-use profile update
```

## Command Chaining

Commands can be chained with `&&`. The browser persists via the daemon, so chaining is safe and efficient.

```bash
browser-use open https://example.com && browser-use state
browser-use input 5 "user@example.com" && browser-use input 6 "password" && browser-use click 7
```

Chain when you do not need intermediate output. Run separately when you need to parse `state` to discover indices first.

## Common Workflows

### Authenticated Browsing

When a task requires an authenticated site, use Chrome profiles:

```bash
browser-use profile list
browser-use --profile "Default" open https://github.com
```

### Exposing Local Dev Servers

```bash
browser-use tunnel 3000
browser-use open https://abc.trycloudflare.com
```

## Multiple Browsers

For subagent workflows or multiple browsers in parallel, use `--session NAME`. Each session gets its own browser. See `references/multi-session.md`.

## Configuration

```bash
browser-use config list
browser-use config set cloud_connect_proxy jp
browser-use config get cloud_connect_proxy
browser-use config unset cloud_connect_timeout
browser-use doctor
browser-use setup
```

Config is stored in `~/.browser-use/config.json`.

## Global Options

| Option | Description |
|--------|-------------|
| `--headed` | Show browser window |
| `--profile [NAME]` | Use real Chrome; bare `--profile` uses `Default` |
| `--cdp-url <url>` | Connect via CDP URL |
| `--session NAME` | Target a named session |
| `--json` | Output as JSON |
| `--mcp` | Run as MCP server via stdin/stdout |

## Tips

1. **Always run `state` first** to see available elements and their indices.
2. **Use `--headed` for debugging** to see what the browser is doing.
3. **Sessions persist** between commands.
4. **CLI aliases**: `bu`, `browser`, and `browseruse`.
5. **If commands fail**, run `browser-use close` first, then retry.

## Troubleshooting

- **Browser won't start?** Run `browser-use close`, then `browser-use --headed open <url>`.
- **Element not found?** Run `browser-use scroll down`, then `browser-use state`.
- **Run diagnostics:** `browser-use doctor`.

## Cleanup

```bash
browser-use close
browser-use tunnel stop --all
```
