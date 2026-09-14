# Optional features and site options

[Help index](index.md) · [Windows](windows.md) · [Reference and provider setup](reference.md)

## Account preferences

The following changes are per user and preserve site content:

| Control | MIO action | Meaning |
|---|---|---|
| MIO API | `set_mio_api_enabled` | Master switch shared with the MIO dock button. Defaults off. Disabling hides MIO, suspends window integrations, closes chat and stops the remaining action chain. Tips do not need AI. |
| Show MIO on wallpaper | `set_mio_show_on_wallpaper` | Show or hide the desktop mascot, independently of window chat and contextual tips. Defaults on. Also available in Make it yours and the MIO dock context menu. |
| AI assistant | `set_ai_assistant` | Enable or disable assistant requests; requires a configured provider that supports function calling. Disabling prevents subsequent MIO requests. |
| WordPress Heartbeat | `set_heartbeat_rate` | 15, 30, 45 or 60 seconds. Faster intervals increase server work; 60 is the default. Applies through WordPress Heartbeat settings on page load. |
| Window links | `set_window_links_enabled` | Master switch for relation visuals and group behaviour. |
| Raise related windows | `set_window_link_raise_on_focus` | Raise a relation group with the focused member. |
| Highlight related windows | `set_window_link_highlight` | Outline related windows. |
| Wallpaper click shows desktop | `set_show_desktop_on_wallpaper_click` | Clicking empty wallpaper toggles Show Desktop. |
| Post status ribbons | `set_show_post_status_ribbons` | Display draft/pending/private/scheduled ribbons in My WordPress. |
| Developer mode | `set_developer_mode_enabled` | Expose developer surfaces, including Code Blue and the Starter Widget. A fresh menu payload is requested after the save. |
| Folder sharing | `set_folders_sharing_enabled` | Hide or show this user's sharing features. Disabling does not delete sharing records. |

The close-all confirmation and link style settings are described in [Windows](windows.md).

## Native admin apps

These beta choices change which implementation opens from the corresponding launcher, for this account only. They do not grant permissions the account lacks:

- `set_station_home_enabled`: native Station Home instead of the classic Dashboard.
- `set_native_posts_enabled`: native Posts table.
- `set_native_pages_enabled`: native Pages table.
- `set_native_users_enabled`: native Users window, still subject to user-list capabilities.
- `set_native_plugins_enabled`: native Plugins window, still subject to plugin-management capabilities.
- `set_native_comments_enabled`: native Comments window, still subject to the server's comment capabilities.

Turning a beta off selects the classic admin path on future opens. It does not uninstall anything or rewrite an already open editor.

## Administrator-only Extended options

These switches affect the whole site and all users. MIO offers them only when Preferences reports `manage_options`, and the server action checks that capability again. Use `enabled: true` or `false`:

| MIO action | Site option |
|---|---|
| `set_extended_window_prewarm` | Hover-intent window preloading. |
| `set_extended_admin_asset_cache` | Shared administration asset caching. |
| `set_extended_media_library_enhanced` | Enhanced Media Library. |
| `set_extended_games` | Games module and its registered launchers. |
| `set_extended_agents` | Agent features. |
| `set_extended_network` | Network features. |

Changes merge over existing options and use the app's `extended` action. A separate menu refresh reflects newly enabled registrations. Asset-cache and window-prewarm mirrors apply on shell reload. MIO must not silently reload a page that might hold unsaved work.

## AI comment scoring

`set_comments_ai` controls site-wide AI comment scoring. It is administrator-only and requires the comments AI provider to be configured. It uses the existing `comments-ai` app action and refreshes the shell's availability mirror. It is separate from your personal AI assistant toggle.

## Welcome introductions

`show_introductions_again` makes welcome introductions eligible to display on their next open. It clears only the seen-introduction markers. It does not reset preferences or delete content.

## Intentionally absent

Reset all preferences, delete folder-sharing data, delete uploaded themes are not available as MIO actions. Destructive actions must remain explicit UI operations. No write action is registered with WordPress's public Abilities registry. See [Actions](actions.md).
