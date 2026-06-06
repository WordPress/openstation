=== Desktop Mode ===
Contributors: automattic, allterraindeveloper, epeicher
Tags: desktop, admin, ui, productivity, ai
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.11.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Reimagines the WordPress admin as a desktop OS with draggable windows and a dock. Per-user opt-in. By Automattic.

== Description ==

Desktop Mode renders /wp-admin as a desktop operating system. Admin screens open as draggable, resizable, minimizable windows on a desktop, with a left-edge dock built from the admin menu. The classic admin stays untouched for everyone else, and deactivating the plugin restores vanilla Core exactly.

Built and maintained by [Automattic](https://automattic.com) — the company behind WordPress.com, Jetpack, WooCommerce, and Tumblr. Zero Core patches: every feature is wired through public WordPress hooks.

= Highlights =

* **Per-user opt-in.** An admin-bar toggle flips a user-meta flag; nobody else sees any change.
* **Window system.** Iframe windows load admin pages chromelessly. Native windows render directly in the parent DOM via a public registration API. Both share drag, resize, minimize, maximize, fullscreen, and detach-to-new-tab.
* **Dock + taskbar.** Left-edge dock for core menus; bottom macOS-style pill taskbar for plugin menus. Letter-badge icon fallback for plugins without icon art.
* **Virtual desktops ("Spaces").** Multiple desktops per user, each with its own window set. Overview grid surfaces the Spaces switcher and thumbnails.
* **Arrange & snap.** Cascade, Tile, Overview, Snap-to-grid. Plugins contribute custom entries.
* **Wallpaper & widget registries.** Server- and client-side registration. CSS presets plus canvas (WebGL/2D) wallpapers with collision-aware surface data for snow/rain/physics effects.
* **Desktop icons.** Wallpaper-layer shortcuts that open native windows or admin URLs.
* **AI Copilot (optional).** Cmd+K palette backed by an agentic loop with built-in search tools. Disabled until you supply an API key. See "External services" below.
* **Slash commands & palettes.** Public registration APIs for plugin authors.
* **Cross-frame drag bridge.** Media-library attachments drag across iframe boundaries.
* **Session persistence.** Window stack (including desktops, focus, state) restored across reloads.
* **i18n.** Full gettext coverage across PHP and TypeScript; Spanish translation shipped.

= For plugin authors =

Desktop Mode is built to be extended. Every significant behavior is hookable — add a desktop icon, register a dock item, gate desktop mode by role, react to window events, or register a native window, all from your own plugin with zero patches here.

Comprehensive PHP and JavaScript hook surface, plus stable `desktop_mode_register_*` functions for windows, widgets, wallpapers, icons, window tabs, commands, settings tabs, and AI tools. See the [developer docs on GitHub](https://github.com/WordPress/desktop-mode/tree/trunk/docs).

= External services =

This plugin's optional **AI Copilot** sends data to **OpenAI** (`https://api.openai.com/v1/responses`) when, and only when, an administrator configures an OpenAI API key in **Settings → AI**. With no key configured, no external requests are made.

When the AI Copilot is enabled and a user invokes it (via Cmd+K or the slash-command palette):

* **What is sent:** the user's prompt, the conversation history for the active session, the chosen model identifier (e.g. `gpt-4o-mini`), and tool-call metadata. The plugin's built-in tools (`search_posts`, `search_pages`, `search_comments`) run WordPress's native keyword search and may include excerpts of the matching posts/pages/comments in tool results, which are then sent back to OpenAI as part of the agentic loop.
* **When it is sent:** on user-initiated AI requests, and (if enabled) on comment-save hooks for spam analysis. Comment spam analysis runs server-side as part of the comment-insert flow. Posts, pages, and taxonomy terms are not sent automatically.
* **Why it is sent:** to obtain model completions and tool-call decisions that drive the AI Copilot.
* **Who provides the service:** OpenAI, L.L.C. — see the [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/) and the [OpenAI Privacy Policy](https://openai.com/policies/row-privacy-policy/).

The AI Copilot's provider layer is also extensible: third-party plugins may register additional providers via `desktop_mode_register_ai_provider()`. Those providers may send data to other endpoints; review each plugin's own privacy disclosure separately.

No other external services are contacted by this plugin.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/`, or install via **Plugins → Add New → Upload Plugin**.
2. Activate the plugin through the **Plugins** screen in WordPress.
3. Click the **desktop** icon in the admin bar's top-right corner. The admin reloads inside the desktop shell.
4. Click the same icon again at any time to return to the classic admin.

= Optional: enable the AI Copilot =

1. Open **Settings → AI** inside desktop mode.
2. Paste an OpenAI API key and pick a model.
3. Press **Cmd+K** (or **Ctrl+K**) anywhere in desktop mode to open the AI palette.

== Frequently Asked Questions ==

= Does this change anything for users who don't opt in? =

No. The classic admin is untouched until a user toggles desktop mode on for themselves. Deactivating the plugin restores vanilla Core exactly.

= Does the plugin require an external service to function? =

No. The desktop shell, windowing, dock, taskbar, virtual desktops, widgets, wallpapers, and all extension APIs work entirely on-site. The AI Copilot is the only feature that contacts an external service, and it is disabled until an administrator configures an API key. See "External services" in the description.

= Does it patch WordPress core? =

No. Every feature is wired through public WordPress actions and filters.

= How do I disable desktop mode for my user? =

Click the desktop icon in the admin bar a second time to flip the toggle off. The plugin can also be deactivated globally from the Plugins screen.

= Where is the developer documentation? =

In `docs/` inside the plugin, and on [GitHub](https://github.com/WordPress/desktop-mode/tree/trunk/docs). The hook reference, JavaScript reference, bridge protocol, and copy-paste examples all live there.

== Screenshots ==

1. The desktop shell — wallpaper, dock, taskbar, and a window with the admin loaded inside it.
2. Multiple windows open across virtual desktops (Spaces).
3. The AI Copilot Cmd+K palette in action.
4. Custom wallpapers and widgets registered by a plugin.
5. The Arrange menu — Cascade, Tile, Overview, Snap to grid.

== Credits ==

Desktop Mode is brought to you by [Automattic](https://automattic.com). The plugin is open source under GPLv2-or-later; contributions are welcome on [GitHub](https://github.com/WordPress/desktop-mode).

= Third-party libraries =

The plugin bundles the following third-party JavaScript library, loaded on demand only when a feature that needs it is in use:

* **[PixiJS](https://pixijs.com/)** (MIT License) — used by the interactive **OS Settings → About** scene, the **Content Graph** window, and built-in canvas wallpapers (e.g. the animated WordPress logo). PixiJS is loaded from the plugin's own `assets/vendor/` directory; no CDN requests are made.

== Changelog ==

= 0.11.0 =
* AI scope narrowed: the only automatic AI analysis is now comment spam scoring — posts, pages, and taxonomy terms are no longer sent to OpenAI on save
* The AI assistant now finds posts, pages, and comments with WordPress's native keyword search instead of pre-analyzed summaries
* Removed the bulk `/ai/reindex` REST endpoint
* One-time upgrade unschedules any leftover post/term analysis cron events
* Breaking: the post/term analysis hooks (`desktop_mode_ai_post_prompt`, `desktop_mode_ai_term_prompt`, `desktop_mode_ai_post_analyzed`, `desktop_mode_ai_term_analyzed`, `desktop_mode_ai_supported_post_types`, `desktop_mode_ai_supported_taxonomies`, `desktop_mode_ai_schema_content`) have been removed — see docs/migration-ai-comment-only.md

= 0.10.0 =
* The native Posts, Pages, Users, Plugins, and Comments windows are now opt-in Beta — they no longer replace the classic admin screens by default
* New "Beta features" section in OS Settings → Features to turn each native window on
* One-time upgrade resets the native windows to off so the redesigned screens are a deliberate choice

= 0.9.0 =
* Gate per-user REST routes on desktop mode enabled
* Refine recycle bin badge styling and sync on stop
* Clear comments selection after applying action
* Don't let a failing sync block the agent
* Make the AI-disabled error link to AI Settings

= 0.8.9 =
* Improve drag-and-drop handling in chromeless bridge and iframe bridge
* The whole shell loads faster, especially the first time you open wp-admin
* Open an app from the wallpaper or from the dock — it's the same window now (no more two copies floating around)
* Minimize a window and the dock icon shows it's minimized — even if you opened it from the desktop icon
* Click "+ New" twice and you get two editors. Drafting a post and want to start another? Just click again
* "Switch to Desktop Mode" always takes you to the dashboard, so you know where you're starting from
* Resizing a window and accidentally letting go over the desktop no longer minimizes everything
* WooCommerce: the "Add Order" button is back on the Orders page
* "Add New" buttons (Add Post, Add Order, Add anything) stay visible inside every plugin page
* After we ship a fix, you get it on your next page load — no more "try refreshing twice"

= 0.8.8 =
* Align dock badge with in-window update count
* Make every dock scrollable, keep system tiles pinned
* No more flash when you create, move, or delete a file or shortcut on the desktop
* Trashing a folder that contained other folders now works (used to silently fail)
* Drag an image from the Media Library straight into a Gutenberg post, it now inserts
* Edit User screen: the form is centered instead of pinned to the left
* Title-bar icons (Help, etc.) are now visually centered
* Sticky notes powered by WP Guidelines

= 0.8.7 =
* Bump Tested up to WordPress 7.0
* Fix plugins window stale-nonce 'Cookie check failed' on long-running sessions
* Fix plugin .zip drop routing to Media Library uploader
* Add server-side search to entity list views
* Rename Browse tab to Add Plugin
* Drag and drop improvements

= 0.8.6 =
* Light indicators for native-window-target dock icons
* Additional fixes and polish
* Add compatibility layer for Divi script dependencies and tests
* Show plugin icons
* Open off-site menu items in a new browser tab

= 0.8.6-rc1 =
* Tag cloud & category mindmap: search, clustering, server cache
* Drag & Drop from local desktop
* Implement loading skeletons and staggered animations for file tiles
* Arrow-key shortcuts + Overview-from-Show-Desktop fix
* Shortcuts popover, dock-style tooltips, reorder
* Add Featured Plugins View and Ribbon Component
* Add "Automatic Updates" column and related functionality to Plugins window
* Add window notices feature with persistent dismissal and server sync
* Polish four framework surfaces for plugin authors
* Disable focus on other window actions
* Add Media section to "My WordPress" + uniform preview-pane hook surface
* Refactor My WordPress to use `<wpd-tile>` + add post status ribbons
* Allow deactivating plugins in CMO desktop & dock
* OS-file drop — progress UI, live refresh, cancel cleanup, CMO
* Group-by selector + click-to-deselect + focused-icon centering
* Test against PHP 8.3 and 8.4
* Enhance minimize/restore behavior to preserve pre-minimize state and add cross-state transition tests

= 0.8.5 =
* Shared folders, heartbeat widget, and heartbeat-pipeline hardening
* Recycle Bin: show item type badges inline next to title
* Plugins window: expandable rows with rich plugin details
* Remember native window size across opens
* Fix blank plugin icons in the Plugins window
* Restore "Show desktop on wallpaper click" as an opt-in setting
* Fix plugin update refresh, dock badge, and stuck-row failures
* Trash bin polish: URL badge, live placement badge, no media auto-trash
* Throw on empty REST body to avoid TypeError after self-replace
* Hide Media filter tab when MEDIA_TRASH is off
* Sequence openCurrentPage after restoreSession to avoid duplicate windows
* Fix window refresh issue on new sessions

= 0.8.4 =
* Faster Desktop Mode, main bundle cut by 59 %
* "Edit Post" from the front-end admin bar opens nothing
* Cross-page admin-link clicks: state, destructive actions, referer hint
* Warn loudly when a `<wpd-*>` tag is used without being imported
* Support re-uploading existing plugins, add post-install Activate panel
* Restore the full WordPress command palette inside Cmd+K

= 0.8.3 =
* Feat comments as native windows
* Chrome <111 titlebars + duplicate-placement REST 500s
* SW navigation interception caused window-in-window after core update
* Open each post as its own window from the Posts window
* Fix Users window data + live-refresh, plus per-window REST clients
* Session-expiry cascade + Plugins window sync
* Narrow scope to /wp-admin/ and throttle SW reloads
* Plugins window: real updates, not just a phantom badge
* Support plain permalinks for REST URL construction
* Hide registered icons from desktop instead of trashing

= 0.8.2 =
* Many fixes and new features
* Add unit test to ensure bridge script skips core AJAX update buttons
* Native Plugins window + `<wpd-card>`
* Appearance window polish + dock-peek fixes
* Fix upload theme
* Implement favicon resolver and associated tests for desktop mode
* Auto-inject X-WP-Nonce for REST API requests
* Enhance user management functionality in WordPress REST API
* Fix user role updates
* Fix plugin native issues
* Enhance color scheme preview functionality by adding shell scheme flipping
* Fix rearrange icons out of desktop
* Open each post in its own window
* Add item visibility and dock order settings
* Add first-run welcome dialog for Desktop Mode
* Fix dock management
* Refetch desktop placements on Recycle Bin restore

= 0.8.1 =
* Framework rework and stability improvements — significant internals refactor, smoother window lifecycle, and more reliable bridging between iframe and native windows.
* Drag and drop reworked end-to-end: calmer pointer behavior, more accurate hit-testing, and reliable handoff across windows.
* Posts, Pages, and Users now open as native desktop windows — direct DOM rendering inside the shell instead of an iframe, faster open, instant interaction, and UI tailored to the windowing model.
* New Content Graph tool — an interactive map of how your content links together. Pan, zoom, and focus a node to explore its neighborhood.
* Cross-page admin link routing in the chromeless bridge so links across the admin stay inside the desktop shell.
* Many bug fixes across the admin bar, Fullscreen toggle, resize handles over iframes, real-time icon refresh on plugin activation, and the PWA shell.

= 0.5.1 =
* Code editor and framework improvements.
* Enhanced AI provider integration: third-party providers may register through `desktop_mode_register_ai_provider()`.
* Title-bar button registry with icon painting for plugin authors.
* OS Settings tabs are now extensible via `desktop_mode_register_settings_tab_script()` / `desktop_mode_register_settings_tab()`.
* AI Copilot extensibility: server-side tool registry (`desktop_mode_register_ai_tool()`) and client-side `wp.desktop.ai.ask()` programmatic entry point.
* UI component kit expansion (~25 `<wpd-*>` web components).
* Backtick hotkey to cycle window focus.
* Unified command palettes via the palette registry.
* OS Settings Help tab.

= 0.5.0 =
* Command registration APIs (`desktop_mode_register_command_script()` / `desktop_mode_register_command()`) with live install/activate refresh.
* Media-library enhancement enabled by default, with opt-out.
* Dock CSS selectors updated; overflow handling improved.

See the [GitHub releases page](https://github.com/WordPress/desktop-mode/releases) for the full history.

== Upgrade Notice ==

= 0.8.1 =
Framework and stability rework, reworked drag and drop, native Posts/Pages/Users windows, and a new Content Graph tool. Backwards-compatible.

= 0.5.1 =
Adds AI Copilot extensibility (server-side tools, multi-provider support) and a title-bar button registry. Backwards-compatible.
