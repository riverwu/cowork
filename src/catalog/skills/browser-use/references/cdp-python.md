# Raw CDP & Python Session Reference

The CLI commands handle most browser interactions. Use `browser-use python` with raw CDP when you need browser-level control the CLI does not expose, such as activating a tab so the user sees it, intercepting network requests, emulating devices, or working with Chrome target IDs directly.

## How the Python session works

`browser-use python "statement"` executes one Python statement per call. Variables persist across calls.

A `browser` object is pre-injected with sync wrappers for common operations such as `browser.goto()` and `browser.click()`. For anything beyond those, two internals give you full access:

- `browser._run(coroutine)` runs any async coroutine synchronously with a 60s timeout.
- `browser._session` is the raw `BrowserSession` with full CDP client access.

## Getting a CDP client

```bash
browser-use python "cdp = browser._run(browser._session.get_or_create_cdp_session())"
```

After this, `cdp` persists across calls. Use `cdp.cdp_client.send.<Domain>.<method>()` for CDP commands and `cdp.session_id` for the session parameter.

## Recipes

### Activate a tab

The CLI's `tab switch` changes the agent's internal focus, but Chrome's visible tab may not change. To show the user a specific tab:

```bash
browser-use python "targets = browser._session.session_manager.get_all_page_targets()"
browser-use python "print([(i, t.url) for i, t in enumerate(targets)])"
browser-use python "cdp = browser._run(browser._session.get_or_create_cdp_session(target_id=None, focus=False))"
browser-use python "browser._run(cdp.cdp_client.send.Target.activateTarget(params={'targetId': targets[1].target_id}))"
```

### List all tabs with target IDs

```bash
browser-use python "targets = browser._session.session_manager.get_all_page_targets()"
browser-use python "
for i, t in enumerate(targets):
    print(f'{i}: {t.target_id[:12]}... {t.url}')
"
```

### Run JavaScript and get the result

```bash
browser-use python "cdp = browser._run(browser._session.get_or_create_cdp_session())"
browser-use python "result = browser._run(cdp.cdp_client.send.Runtime.evaluate(params={'expression': 'document.title', 'returnByValue': True}, session_id=cdp.session_id))"
browser-use python "print(result['result']['value'])"
```

### Emulate a mobile device

```bash
browser-use python "cdp = browser._run(browser._session.get_or_create_cdp_session())"
browser-use python "browser._run(cdp.cdp_client.send.Emulation.setDeviceMetricsOverride(params={'width': 375, 'height': 812, 'deviceScaleFactor': 3, 'mobile': True}, session_id=cdp.session_id))"
```

### Get cookies via CDP

```bash
browser-use python "cdp = browser._run(browser._session.get_or_create_cdp_session())"
browser-use python "cookies = browser._run(cdp.cdp_client.send.Network.getCookies(params={}, session_id=cdp.session_id))"
browser-use python "print(cookies)"
```

## Tips

- Each `browser-use python` call is one statement.
- Multi-line strings work for `for` loops and `if` blocks, but do not mix statements and expressions.
- Variables persist across calls.
- The `browser._run()` bridge has a 60-second timeout.
- All CDP domains are available through `cdp.cdp_client.send.<Domain>.<method>()`.
