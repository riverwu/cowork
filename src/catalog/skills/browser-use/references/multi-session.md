# Multiple Browser Sessions

## Why use multiple sessions

Use multiple sessions when you need more than one browser at a time:

- Cloud browser for scraping plus local Chrome for authenticated tasks.
- Two different Chrome profiles simultaneously.
- Isolated browser for testing that will not affect the user's browsing.
- A headed browser for debugging while a headless browser runs in the background.

## How sessions are isolated

Each `--session NAME` gets:

- Its own daemon process.
- Its own Unix socket at `~/.browser-use/{name}.sock`.
- Its own PID file and state file.
- Its own browser instance.
- Its own tab ownership state.

## The `--session` flag

Pass the flag on every command targeting that session:

```bash
browser-use --session work open <url>
browser-use --session work state
browser-use state
```

If you forget `--session`, the command goes to the `default` session. This is the most common mistake when interacting with the wrong browser.

## Combining sessions with browser modes

```bash
browser-use --session cloud cloud connect
browser-use --session chrome connect
browser-use --session debug --headed open <url>
```

Each session is independent. The cloud session talks to a remote browser, the chrome session talks to the user's Chrome, and the debug session manages its own Chromium.

## Listing and managing sessions

```bash
browser-use sessions
browser-use --session cloud close
browser-use close --all
```

## Common patterns

**Cloud plus local authenticated:**

```bash
browser-use --session scraper cloud connect
browser-use --session scraper open https://example.com
browser-use --session auth --profile "Default" open https://github.com
browser-use --session auth state
```

**Throwaway test browser:**

```bash
browser-use --session test --headed open https://localhost:3000
browser-use --session test close
```

**Environment variable:**

```bash
export BROWSER_USE_SESSION=work
browser-use open <url>
```
