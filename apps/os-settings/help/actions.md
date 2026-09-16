# Private action catalog and chained examples

[Help index](index.md) · [Appearance](appearance.md) · [Themes](themes.md) · [Windows](windows.md) · [Navigation](navigation.md) · [Features](features.md) · [Wallpaper](wallpaper.md)

## Retrieval and context

`search_help` searches this window's Markdown collection. `read_help` reads a known document and returns its valid links. Links never grant filesystem or network access. `read_settings` returns current account preferences, current page and capability-gated site facts. `list_options` returns live choices with labels, theme surface colours and recommendations. Every model round receives a freshly evaluated caller prompt and the current action allowlist.

## Appearance and Windows setters

Each takes `{ "value": ... }`:

`set_accent`, `set_desktop_theme`, `set_wallpaper`, `set_desktop_layout`, `set_dock_placement`, `set_dock_behavior`, `set_side_dock_behavior`, `set_dock_size`, `set_dock_rail_renderer`, `set_admin_bar_mode`, `set_window_radius`, `set_unfocus_effect`, `set_window_reveal`, `set_window_reveal_duration`, `set_window_link_renderer`, `set_window_link_visibility`, `set_mobile_layout`, `set_heartbeat_rate`.

Specialized value shapes: `set_custom_accent` accepts a hex `value`; `set_custom_gradient` accepts `from`, `to`, `angle`; `set_navigation_placement` accepts `id`, `placement`; `set_mobile_tabs` accepts `ids`; `apply_theme_recommendations` takes no arguments.

## Account switches

Each takes a boolean `value`:

`set_window_links_enabled`, `set_window_link_raise_on_focus`, `set_window_link_highlight`, `set_show_desktop_on_wallpaper_click`, `set_show_post_status_ribbons`, `set_developer_mode_enabled`, `set_folders_sharing_enabled`, `set_station_home_enabled`, `set_native_posts_enabled`, `set_native_pages_enabled`, `set_native_users_enabled`, `set_native_plugins_enabled`, `set_native_comments_enabled`, `set_confirm_close_all_windows`, `set_library_hd_only`.

`set_ai_assistant` takes boolean `enabled`; it is availability/capability-gated. The six `set_extended_*` actions also take boolean `enabled`; see [Features](features.md) for every name and scope.

## Utilities

`open_section`, `search_settings`, `open_image_picker`, `search_wallpaper_images`, `select_wallpaper_image`, `open_theme_upload`, `open_wallpaper_settings`, `set_snow_settings`, `show_introductions_again`, `list_components`, `open_component_reference`, `show_connectors_location`. Some deliberately open a UI for the user's file selection rather than claiming direct access to a local file.

## Chain: rounded corners, one dock, dynamic

1. `set_window_radius({ "value": "round" })`.
2. `set_desktop_layout({ "value": "unified" })`.
3. `set_dock_behavior({ "value": "dynamic" })`.

The action loop can receive multiple calls in a round, but executes them sequentially and rechecks context and permission before each. Each save completes before the next write starts. A following model round sees outcomes and can answer accurately.

## Chain: a darker theme and my own layout

1. `list_options({})` and inspect actual theme descriptions and surface colours.
2. Choose a returned slug that matches the request, or ask the user if unclear.
3. `set_desktop_theme({ "value": "<returned slug>" })`.
4. Apply the explicitly requested layout and corner overrides afterwards, so first-use theme recommendations do not supersede them.

## Limits and failures

A turn allows up to eight model rounds and sixteen calls per round. Repeated identical actions stop the loop. Arguments must match the action's runtime validator; unknown action names, unknown fields, malformed values and unavailable ids are rejected before a write. An unknown or malformed action does not fall back to a global command.

Focus changes, chat close, window close and Stop cancel pending work. A submitted network write cannot necessarily be recalled; MIO must distinguish cancellation from rollback. Earlier completed actions are preserved if a later action fails. MIO never automatically retries a potentially completed write after a network failure.

The public WordPress Abilities registry remains unchanged. Destructive resets/deletions, arbitrary URLs, raw settings bags, arbitrary app dispatch and filesystem access are absent. Third-party apps follow the same opt-in pattern with their own help, prompt and validated actions.

`clear_wallpaper_image` takes no arguments. It clears the wallpaper selection and returns an active image wallpaper to the default; the Media Library attachment is preserved. This is reversible by selecting the image again.

## Repair and outcome reporting

MIO may correct invalid arguments twice before a third validation failure ends the user turn. Corrections do not count as saved actions. Read tools can refresh options or settings after a change; a completed or uncertain write must not be replayed. Status summaries distinguish reads, rejected candidates, confirmed writes and unknown write outcomes. Permission failures and cancelled requests are terminal. Read longer help documents using their section IDs or continuation cursor when `truncated` is true.
