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
- [Gate desktop mode by role](./gate-by-role.md)
- [React to window events](./react-to-window-events.md)
- [Window lifecycle hooks (one subscriber per state)](./window-lifecycle.md)
- [Custom arrange-menu action](./arrange-action.md)
- [Style a specific admin page inside the iframe](./chromeless-style-override.md)
- [Inject data into `wpDesktopConfig`](./inject-shell-config.md)
- [Register a wallpaper (CSS + canvas)](./register-wallpaper.md)
- [Register a desktop icon (Jorvy)](./register-icon.md)
- [Register a slash-command for the AI palette](./register-command.md)
- [Programmatic AI Copilot — `wp.desktop.ai.ask()`](./ai-ask.md)
- [Native window with tabs (auto-swap pattern)](./native-window-with-tabs.md)
- [Layout primitives (body → panel → row → col)](./layout-primitives.md)
- [Native windows — planned (Phase 7)](./native-windows.md)

If your use case isn't here, check [Hooks Reference](../hooks-reference.md) and [JavaScript Reference](../javascript-reference.md) — everything we fire is documented there.
