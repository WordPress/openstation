# wp-desktop-mode — local gotchas

Short file. Things I've forgotten or hand-waved before. If it's obvious from reading the code, don't add it here.

## Live-refresh on plugin install/activate — how it actually works

When the user installs or activates a plugin, the **chromeless bridge** inside the `plugins.php` iframe postMessages `wp-desktop-plugins-changed` to the parent shell with a **payload captured in real admin context** (plugins that gate `admin_menu` on `is_admin()` at load time register correctly there; a REST roundtrip from the shell cannot replicate that, so don't try).

Payload shape (`includes/render.php` builds it, `src/desktop.ts` consumes it):

```
{ dockItems, taskbarItems, nativeWindows, serverWidgets, serverWallpapers,
  serverCommandScripts, serverCommands, desktopIcons }
```

- **PHP-declared** things are in the payload: dock, taskbar, native windows, widgets, wallpapers. The shell diffs them and fires `registry.subscribe` listeners → UI repaints. No F5.
- For widgets and wallpapers, the pattern is: PHP payload carries metadata + `scriptUrl`; the `server-sync` module (`src/{widgets,wallpapers}/server-sync.ts`) dynamically loads the plugin's JS, which then publishes a full def on a global (`window.wpDesktopWallpapers[id]` / `window.wpDesktopWidgets[id]`). The sync reads the def and registers it.
- **Commands use the same pattern since 0.15.0** via `wp_desktop_register_command_script( $handle )` (primary, minimum-ceremony) or `wp_register_desktop_command( $args )` (optional, declares metadata server-side). Sync module: `src/commands/server-sync.ts`. Live unregistration on deactivation works for commands that either (a) declare `script` in PHP metadata, or (b) set `owner` on their JS `registerCommand` call. Plugins that do neither still require F5 on deactivate — graceful backwards-compat.
- **Palettes** (`registerPalette`) are the remaining JS-registered-only gap. No server-side opt-in yet; a new plugin's palette won't appear until F5. Same fix shape as commands if/when needed: `wp_desktop_register_palette_script( $handle )` + payload key + clone the sync module.

**When fixing this kind of "why doesn't X update live?" gap**, match the existing pattern: add server-side registration API (`wp_register_desktop_*`), extend the payload with a `server*` array including `scriptUrl`, add a `src/*/server-sync.ts` module modeled on the wallpaper one, wire it into `applyPayload()` in `desktop.ts`. Don't invent a different mechanism.

## Chromeless admin-bar suppression

`is_admin_bar_showing()` short-circuits to `true` in admin context — the `show_admin_bar` filter alone is NOT sufficient inside chromeless iframes. We pair it with `remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 )` on `admin_init`, AND a CSS rule killing the reserved 32px. Do not remove either half.

## Process reminders to self

- **Read before speculating.** When asked how a mechanism works (refresh flow, hook order, bridge protocol), grep the code first. Hand-waving gets caught.
- **Don't implement architectural changes unilaterally.** PHP API additions, payload shape changes, and new registry-sync modules are all load-bearing for plugin authors. Propose, get the green light, then code.
