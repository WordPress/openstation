---
name: openstation-extension
description: "Use when building or changing your own WordPress plugin that extends OpenStation (the desktop-mode plugin): native windows, dock items, desktop icons, widgets, wallpapers, commands, window actions, or reacting to window events. Keeps the plugin on OpenStation's documented public API (PHP hooks and functions, wp.os.*, the postMessage bridge, <os-*> components) so it keeps working as OpenStation updates. Triggers on: OpenStation extension, OpenStation plugin, desktop-mode add-on, extend OpenStation, openstation_register_window, wp.os, os-* component."
license: GPL-2.0-or-later
---

Build your own plugin on top of OpenStation. It is a separate plugin with its own folder and repository. OpenStation is a dependency you install, never code you change.

## Read first

Before writing code, read these from https://github.com/WordPress/openstation/tree/trunk/docs:

- `README.md` and `getting-started.md`: the index and the five-minute tour.
- `hooks-reference.md`: every PHP action, filter and function, with its status.
- `javascript-reference.md` and `api-index.md`: `wp.os.*`, CustomEvents and the iframe `postMessage` bridge.
- `components-reference.md`: the `<os-*>` web components.
- `examples/`: find the recipe closest to the task and start from it.

## Set up

Give the plugin a `.wp-env.json` that installs OpenStation next to it:

```json
{
	"plugins": [ ".", "https://downloads.wordpress.org/plugin/desktop-mode.zip" ]
}
```

Make sure Docker is running and Node 20+ is installed. Then, in the plugin folder, run `npx @wordpress/env start`. It uses port 8888; if that port is taken, pick a free one and run `WP_ENV_PORT=<port> npx @wordpress/env start` instead. Check that http://localhost:<port>/wp-admin loads (admin / password) with both plugins active, then switch OpenStation on from the admin-bar toggle.

## Rules

1. **Only the public API.** Use the PHP actions, filters and functions in `hooks-reference.md`, `wp.os.*` and its events, the `postMessage` bridge, and `<os-*>` components loaded with `await wp.os.loadComponents( [ … ] )`. Prefer **Stable** over **Experimental**. Never use anything marked **Planned**, because it isn't fired yet.
2. **Never touch OpenStation.** Don't edit its files, copy them into the plugin, import from its source, or call undocumented globals, functions or CSS classes. Override styles only through documented hooks such as `openstation_chromeless_styles`.
3. **Declare and guard the dependency.** Add `Requires Plugins: desktop-mode` to the plugin header. Guard PHP with `function_exists( 'openstation_is_enabled' )` and JS with `wp.os.whenReady()`. The plugin must not break anything when OpenStation is inactive or the user has it switched off.
4. **WordPress way.** Follow the WordPress coding standards. Prefix every function, hook, handle and option with the plugin's own prefix, never `openstation_`. Use `wp_enqueue_*`, sanitize input, escape output, and protect every write with a nonce and a capability check.
5. **Missing hook? Stop.** If the public API can't do something, don't work around it. Tell the user which hook or method is missing and suggest opening an issue on https://github.com/WordPress/openstation; the project welcomes new hooks.

## Check before finishing

- The feature works with OpenStation on, and the admin is unchanged with it switched off or deactivated.
- No console errors, and no PHP notices in `wp-content/debug.log`.
- Every OpenStation API the plugin uses appears in the docs, and you can name its status.
