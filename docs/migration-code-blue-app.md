# Migration — Code Blue becomes an App Framework app

Code Blue, the error-log reader, is now an `.os.php` app (`apps/code-blue/`) driven by the [App Framework](./app-framework.md) instead of a PHP module plus a TypeScript bundle. The window is the same — same id (`openstation-code-blue`), same desktop icon, same features, same gate — so saved sessions, icon positions and the Developer-mode toggle carry over untouched. What changed is the surface underneath it.

## Removed

| Surface | Replacement |
|---|---|
| REST routes `GET /desktop-mode/v1/code-blue/sources`, `GET` / `DELETE /desktop-mode/v1/code-blue/entries` | There are no Code Blue routes. Every interaction is a dispatch: `POST /desktop-mode/v1/apps/openstation-code-blue/dispatch` with `{ action, state, args }`. To read the window's data from code, call `openstation_app_render( 'openstation-code-blue', array( 'range' => 'all' ) )` — it returns the manifest, the state and the rendered body. |
| Filter `openstation_code_blue_window_args` | [`openstation_app_manifest`](./hooks-reference.md#openstation_app_manifest--experimental-filter) — `$manifest['width']`, `['icon']`, `['title_bar_buttons']`, … for `$id === 'openstation-code-blue'`. |
| Filter `openstation_code_blue_icon_args` | The same manifest filter: `$manifest['desktop_icon']` (`position`, `pinned`). |
| Filter `openstation_code_blue_template_html` | [`openstation_app_response`](./hooks-reference.md#openstation_app_response--experimental-filter) — post-process `$response['html']` on every render. |
| PHP functions `openstation_code_blue_parse()`, `_make_entry()`, `_log_sources()`, `_tail()`, `_read_source()`, `_user_can_use()`, … | Namespaced equivalents in `OpenStation\Apps\CodeBlue`: `parse()`, `make_entry()`, `sources( $os )`, `tail()`, `read( $os, $source )`, `can_use( $os )`. They are loaded with the app on `init` @10. |
| Script handle `openstation-code-blue`, bundle `assets/js/code-blue[.min].js`, `window.openStationNativeWindows['openstation-code-blue']` published by that bundle | The shared `openstation-app-runtime` bundle publishes the render callback. Nothing to enqueue. |
| Style handle `openstation-code-blue` → `assets/css/code-blue.css` | `openstation-app-openstation-code-blue` → `apps/code-blue/code-blue.css`, still a first-open companion. |

## Unchanged

- `openstation_code_blue_user_can_use`, `openstation_code_blue_log_sources`, `openstation_code_blue_entries`, `openstation_code_blue_environment`, `openstation_code_blue_max_bytes`, `openstation_code_blue_max_entries` (filters) and `openstation_code_blue_log_cleared` (action) keep their names and signatures. The `environment` rows lost their `key` field; `label`, `value`, `on` remain.
- The Developer-mode + `manage_options` (`manage_network_options` on multisite) gate.
- The window id, size, desktop icon, and everything the user sees.

## Why

Code Blue was 3,235 lines — 981 PHP, 1,726 TypeScript, 528 CSS — for one window, most of it REST plumbing, registration and imperative DOM painting. As an app it is under half that: the `.os.php` declares the window and reads the log, the `.os.ts` paints the body and re-slices it instantly (range, search, sort, legend, expand never leave the browser), and it doubles as the proof that the framework can carry a real window: charts (`<os-histogram>`), a filterable list, a title-bar button, a ⋯-menu row, a confirm dialog, auto-refresh. See [The client view](./app-framework.md#the-client-view--osts).
