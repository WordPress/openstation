# Features

Every shipping surface of the WP Desktop Mode shell, with the public extension points called out. This page is the technical inventory — if you're looking for a narrative pitch, start with the [project README](https://github.com/WordPress/desktop-mode#readme).

- **Per-user opt-in**
  Admin-bar toggle sets the `wp_desktop_mode` user meta. A dedicated `/wp-desktop/` portal URL auto-enables desktop mode for first-time visitors (gated by `wp_desktop_portal_auto_enable`) and the `admin_init` redirect sends opted-in users from `/wp-admin/` to the portal (`wp_desktop_admin_redirect_to_portal`).

- **Desktop shell**
  Fixed-viewport desktop that overlays `/wp-admin`: wallpaper area, left dock, bottom taskbar, right-column widget layer, and full windowing system. `wp_desktop_mode_init`, `wp_desktop_shell_before` / `_after`, and the `wp_desktop_shell_config` filter are the main extension points.

- **Window system — iframe + native**
  Iframe windows load admin pages with `?wp_desktop=1` (chromeless mode). Native windows render directly in the parent DOM via `wp_register_desktop_window()` / `wp.desktop.registerWindow()` — multi-tab native windows are supported through `wp_register_desktop_window_tab()`. Both types share drag, resize, minimize, maximize, close, fullscreen, and detach-to-new-tab.

- **Dock + Taskbar**
  Left-edge dock for core WP menus; bottom macOS-style pill taskbar for installed-plugin menus. Placement is routed by `wp_desktop_dock_placement` (dock / taskbar / hidden). Per-item multi-window support via `wp_desktop_dock_item_multi`. Letter-badge icon fallback for plugins without icon art.

- **Virtual desktops ("Spaces")**
  Multiple desktops per user, each with its own window set. Overview grid (zoom-out view) surfaces the Spaces switcher, thumbnails, and create/close controls.

- **Arrange & snap**
  Admin-bar Arrange menu: Cascade, Tile, Overview, Snap to grid. Plugins contribute custom entries via `wp_desktop_arrange_menu_items` and react to clicks via `wp-desktop.arrange.custom-action`. Tile grid dimensions and snap cell size are both filterable.

- **Wallpaper registry**
  Server- and client-side registration (`wp_register_desktop_wallpaper()` / `wp.desktop.registerWallpaper()`). CSS presets + canvas (WebGL/2D) wallpapers with collision-aware surface data (`wp.desktop.getWallpaperSurfaces()`) for snow/rain/physics effects. In-panel `renderEditor` callback for custom controls, shared vendor-module loader (`pixijs` pre-registered).

- **Widgets**
  Right-column floating cards, optionally draggable / resizable outside the column. `wp_register_desktop_widget()` / `wp.desktop.registerWidget()`. Built-in clock. User placement persists per-user in `localStorage`.

- **Desktop icons**
  Wallpaper-layer shortcuts via `wp_register_desktop_icon()` — targets a registered native window or an admin URL.

- **AI Assistant + slash commands**
  Cmd+K palette backed by an OpenAI agentic loop (search_posts, search_pages, search_comments tools). Admin-configured API key + model picker. Auto-analysis on `save_post` / term / comment save with per-entity prompt filters. `wp.desktop.registerCommand()` adds slash commands with autocomplete (`suggest()`), confirm dialogs (`ctx.confirm()`), and full lifecycle hooks (`before-run` / `after-run` / `error`). Built-in `/open [window]` is extensible via `wp-desktop.open-command.items`.

- **Palette registry**
  Cmd+K cycles through all registered palettes (`wp.desktop.registerPalette()`) — the AI assistant is palette 0 by default; additional plugin overlays share the shortcut.

- **Cross-frame drag bridge**
  Media-library attachments drag across iframe boundaries via coordinated postMessage. Site-wide toggle through the Extended Options REST endpoint.

- **Toast notifications**
  Shell-level toasts rendered via the `<wpd-toast>` component. Plugins register their own tone/icon via the `wp_desktop_toast_types` filter. Iframe pages raise a toast through the `wp-desktop-notification` bridge message — it survives the iframe's own lifecycle.

- **OS Settings**
  Native-window settings panel: wallpaper picker (with HD-only media filter), accent color swatches + custom gradient editor, dock size slider, AI platform config, and per-user default-on-startup window. Persisted via `/wp-desktop/v1/os-settings`.

- **Session persistence**
  Full window stack (including desktops, focus, state) is debounce-saved to `/wp-desktop/v1/session` and restored without layout flicker. Viewport-shrink clamping keeps off-screen windows reachable.

- **postMessage bridge**
  Typed messages for title changes, navigation (same-origin validated), focus, color-scheme sync, screen-meta panels (Screen Options / Help), external-link capture, iframe-ready handshake, and observability (`iframe-error`, `iframe-network`).

- **UI component library**
  ~25 `<wpd-*>` web components (`wpd-button`, `wpd-menu`, `wpd-panel`, `wpd-range-field`, `wpd-swatch`, `wpd-toast`, `wpd-tabs`, …) available to plugin authors — rendered server-side via `wp_desktop_component()` or imported in TS.

- **i18n**
  Full gettext coverage across PHP and TypeScript; Spanish translation shipped. Strings go through `wp.i18n` (`__`, `_x`, `_n`, `sprintf`) directly — no shell-specific re-export.

- **Component registration API**
  Stable `wp_register_desktop_*` functions for windows, widgets, wallpapers, icons, and window tabs. All return `true` / `WP_Error` with documented error codes.

- **Public hook API**
  Comprehensive PHP and JS hook surface — dock items, placement, multi-window, native-window lifecycle, widget lifecycle, wallpaper lifecycle + surfaces, window lifecycle, iframe observability, arrange actions, virtual-desktop transitions, palette registration, command lifecycle, batch close, AI prompt + model + post-type filters, accents, toast types, default wallpaper. See [hooks-reference.md](https://github.com/WordPress/desktop-mode/blob/trunk/docs/hooks-reference.md) and [javascript-reference.md](https://github.com/WordPress/desktop-mode/blob/trunk/docs/javascript-reference.md).
