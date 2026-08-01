# Examples

Short, complete, copy-pasteable recipes. Each file is a working plugin snippet — drop it into a plugin file that starts with:

```php
<?php
/**
 * Plugin Name: My Desktop Extension
 */
defined( 'ABSPATH' ) || exit;
```

## Index

- [Add a dock item with a badge](./dock-badge.md)
- [Decorate the dock without forking the renderer](./dock-decoration-hooks.md)
- [Replace the dock rail entirely](./dock-rail-renderer.md)
- [Gate desktop mode by role](./gate-by-role.md)
- [React to window events](./react-to-window-events.md)
- [Site folder — add a preview-pane action button](./my-wordpress-media-action.md)
- [Site folder — custom post types and their folder](./my-wordpress-cpt-section.md)
- [Accept drops on your desktop icon](./tile-drop-handler.md)
- [Window lifecycle hooks (one subscriber per state)](./window-lifecycle.md)
- [Custom arrange-menu action](./arrange-action.md)
- [Style a specific admin page inside the iframe](./chromeless-style-override.md)
- [Window themes — per-window CSS variables](./window-theme.md)
- [Register a desktop theme — whole-OS reskin from a plugin](./register-desktop-theme.md)
- [Window controls — reorder / hide / replace close-min-max](./window-controls.md)
- [Window slots — replace icon, title, banners above/below the title bar](./window-slot.md)
- [Custom window chrome — full title-bar replacement (Experimental)](./custom-chrome.md)
- [Register a custom unfocused-window effect (Experimental)](./custom-unfocus-effect.md)
- [Register a custom window reveal (Experimental)](./window-reveal.md)
- [Window links — relate windows and restyle the ties (Experimental)](./window-links.md)
- [Related entities — extend the title bar's "Related" menu (Experimental)](./related-entities.md)
- [Inject data into `desktopModeConfig`](./inject-shell-config.md)
- [Register a wallpaper (CSS + canvas)](./register-wallpaper.md)
- [Register a game — launcher tile, scoreboard, challenges (Experimental)](./register-game.md)
- [Restyle and drive the mascot (Experimental)](./mascot-customization.md)
- [Register a widget — polling, storage, canvas charts](./register-widget.md)
- [Register a desktop icon (Jorvy)](./register-icon.md)
- [Register a slash-command for the AI palette](./register-command.md)
- [Programmatic AI Copilot — `wp.desktop.ai.ask()`](./ai-ask.md)
- [AI Agents — extend and invoke from a plugin](./agents.md)
- [Retune the Drafts widget's AI writing assistant (Experimental)](./drafts-ai-suggestions.md)
- [Connect to a window — title-bar button + iframe pub/sub](./connect-to-window.md)
- [Iframe-initiated window opens — open/talk to a sibling window from inside a chromeless iframe](./iframe-initiated-window.md)
- [Native window with tabs (auto-swap pattern)](./native-window-with-tabs.md)
- [Layout primitives (body → panel → row → col)](./layout-primitives.md)
- [`<wpd-flyout>` — sliding edge-anchored panel](./wpd-flyout.md)
- [Render a data table — filters, sticky columns, sub-tables](./data-table.md)
- [Loading spinner — presets and color overrides](./spinner.md)
- [Progress bar — determinate, indeterminate, tones](./progress-bar.md)
- [Window loading state — spinner overlay + ready signal](./window-loading.md)
- [Native windows — overview + render-callback contract](./native-windows.md)
- [Native window with bundle-bound config (REST URLs, nonces)](./window-with-config.md)
- [The render `ctx` — `signal`, `onResize`, `onHide`, `onShow`, `markLoading`/`markReady`](./render-ctx.md)
- [Open a file in the Code editor (deep-link from any window)](./code-editor-open.md)
- [Cross-window devtools — instrumentation primitives](./devtools-instrumentation.md)
- [Extend the Trash](./recycle-bin.md)
- [Content changes — live-refresh every window listing your type](./content-changes.md)
- [Customize note → post conversion — `desktop_mode_notes_convert_post_args`](./notes-convert-to-post.md)
- [Programmatic folder sharing — invite from PHP, listen for share events](./share-folder.md)
- [Real file storage — react to uploads, gate policy, share files from PHP](./desktop-file-storage.md)
- [Native Posts window — default-on, remap registry, hooks](./native-posts.md)
- [Native Plugins window — Browse / Install / Reviews / Drag-to-dock](./plugins-window-extras.md)
- [Window activity & the modem dot — `wp.desktop.fetch`, `Window.trackActivity`](./window-activity.md)
- [Pulse a window's icon — `Window.requestAttention()`](./window-request-attention.md)
- [Render a keyed list without losing clicks — `renderKeyedList()`](./keyed-list.md)
- [Build a feed reader without the bookkeeping — `wp.desktop.createInfiniteList()`](./infinite-list.md)
- [Connect to an external service via OAuth — `desktop_mode_register_oauth_relay()`](./oauth-relay.md)
- [Share state across multi-bundle plugins — `wp.desktop.createSharedStore()`](./shared-store.md)
- [Track who's around — `wp.desktop.presence`](./presence.md)
- [Surface a custom "Install as App" button](./pwa-install.md)
- [Send a notification — `wp.desktop.notify()`](./notify.md)
- [Show a banner at the top of a window — `desktop_mode_register_window_notice()`](./window-notice.md)
- [Catch files dragged in from the host OS — `desktop-mode.drop.*`](./os-file-drop.md)

If your use case isn't here, check [Hooks Reference](../hooks-reference.md) and [JavaScript Reference](../javascript-reference.md) — everything we fire is documented there.
