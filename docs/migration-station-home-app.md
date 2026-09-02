# Migration — Station Home becomes an App Framework app

The native Dashboard is now an `.os.php` app (`apps/station-home/`) driven by the [App Framework](./app-framework.md) instead of a PHP module plus a TypeScript bundle — and the first app with **no client half at all**: the body is painted on the server and morphed into the window. The window keeps its id, **`desktop-mode-dashboard`**, so the Dashboard URL remap, the per-user opt-in (`stationHomeEnabled`), saved sessions and every `index.php` entry point carry over untouched. The plugin-card registry is unchanged — same registration API, same preference meta, same hooks.

## Removed

| Surface | Replacement |
|---|---|
| REST route `GET /desktop-mode/v1/station-home` | There is no snapshot to fetch: the app renders its body through `POST /desktop-mode/v1/apps/desktop-mode-dashboard/dispatch`, and `openstation_app_render( 'desktop-mode-dashboard' )` returns the whole window as a value on the server. |
| REST route `POST /desktop-mode/v1/station-home/cards` | `openstation_station_home_set_card_preference( $user_id, $id, $enabled )` — the one write path, which the app's Customize switches call and which still fires `openstation_station_home_card_preference_updated`. |
| PHP functions `openstation_station_home_register_window()`, `_render_template()`, `_register_assets()`, `_build_snapshot()`, `_recent_work()`, `_quick_actions()`, `_editable_post_types()`, `_draft_count()`, `_published_count()`, `_missing_alt_count()`, `_update_count()`, `_rest_*()` | The app registers itself; the model lives in `apps/station-home/parts/snapshot.php` under `OpenStation\Apps\StationHome`. Tune the window through [`openstation_app_manifest`](./hooks-reference.md#openstation_app_manifest--experimental-filter) with `$id === 'desktop-mode-dashboard'`. |
| Constant `OPENSTATION_STATION_HOME_WINDOW_ID` | The id is the app id, `desktop-mode-dashboard`. |
| Script handle `os-station-home`, bundle `assets/js/station-home[.min].js`, window config `endpoint` / `cardsEndpoint` | Nothing. The shared `openstation-app-runtime` bundle drives the window; the stylesheet (`apps/station-home/station-home.css`) is the app's, loaded on first open. |
| The `src/station-home/` directory | The Dashboard URL matcher the shell still needs — `matchesStationHomeUrl()`, `CLASSIC_DASHBOARD_FLAG` — moved to `src/open-targets/station-home-url.ts`. |

## Unchanged

- `openstation_register_station_home_card()`, `openstation_unregister_station_home_card()`, `openstation_station_home_get_registered_cards()`, `openstation_station_home_get_card_preferences()`, `openstation_station_home_build_cards()`, the `OPENSTATION_STATION_HOME_CARD_PREFERENCES_META` meta key, the filters `openstation_station_home_cards` / `openstation_station_home_card_data` and the actions `openstation_station_home_card_registered` / `_preference_updated` / `_error`.
- The window id, title, size, `placement: none`, `read` gate, the Dashboard URL remap and the `desktop_mode_classic` escape, and everything the user sees.

## Changed

- The greeting's hour comes from the site's clock (`wp_date`) rather than the browser's. WordPress has no per-user timezone; the site's is the one it reasons in everywhere else.
- Content changes anywhere on the desktop now repaint the window (`watch( '*' )`), so Continue working, the instruments and the queue follow a post published or a comment moderated in another window without a manual refresh.

## Why

The window was 1,323 lines — a 632-line imperative bundle and its 47-line model, a 422-line module holding two REST routes and the snapshot builder, a 166-line registration/template module, 39 lines of asset registration and a 17-line bootstrap. As an app it is 931 lines of PHP and no JavaScript: a 115-line definition (four actions, one lifecycle handler), a 375-line snapshot model and a 441-line server view — the fetch/paint/loading/error choreography, the REST routes, the config blob and the click delegates are the framework's now. The port also gave `$os->open_url()` its optional third argument, `$icon`, so a window opened from an app keeps its glyph.
