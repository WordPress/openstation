# `extensions/base/`

Shared base library for OpenStation extensions.

Removes ~250 LOC of boilerplate per extension — script registration, AJAX bundle serving with config injection (plus a fire-and-forget `customElements.whenDefined( 'os-table' )` probe whose Promise is discarded — it does NOT defer the bundle's render callback, so render callbacks that need the `<os-*>` upgrade must await it themselves), native-window registration, REST permission gates.

## PHP base classes

- **`OpenStation_Extension_Window`** — extend, declare `window_id()` / `asset_handle()` / `plugin_url()` / `plugin_dir()` / `version()` / `bundle_action()` / `config_global()` / `window_args()` / `config_payload()`, then call `boot()` from the entry plugin file. The base wires `init`, `plugins_loaded`, and `wp_ajax_<bundle_action>`.
- **`OpenStation_Extension_Rest`** — extend, declare `namespace()` and `routes()`, call `boot()`. The base wires `rest_api_init` and provides a default permission callback that gates on `is_user_logged_in()` + your `required_caps()`.

## Client helper

- **`createExtensionWindow< Config >( { id, configGlobal, render } )`** — picks up the config blob the PHP bundle injected, registers the render callback against `window.openStationNativeWindows[ id ]`, surfaces helpful console errors when wiring is broken.

## Migration

The three in-tree extensions (`desktop-mode-code-editor`, `desktop-mode-cron-manager`, `desktop-mode-phpmyadmin`) still ship their hand-rolled boilerplate. Migrating them to the base classes is a follow-up cleanup; the base library is intentionally additive so the migration can land one extension at a time.

## License

GPL-2.0-or-later — same as the OpenStation plugin.
