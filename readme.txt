=== OpenStation — Desktop Windows, Dock & Virtual Desktops for WP Admin ===
Contributors: automattic, allterraindeveloper, epeicher, mmtr86, nickhamze
Tags: admin, dashboard, desktop, productivity, ai
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Turn wp-admin into a desktop OS — windows, dock, virtual desktops, and an AI assistant. Per-user opt-in, zero Core changes. By Automattic.

== Description ==

**Your WordPress admin, reimagined as a desktop.** Every admin screen opens as a draggable, resizable window — edit a post, browse the Media Library, and moderate comments side by side instead of one page at a time.

https://www.youtube.com/watch?v=jii_gGbqUx4

OpenStation is opt-in per user: one click in the admin bar switches you in, one click switches you back. Nobody else on the site sees any change, and deactivating the plugin restores the classic admin exactly. Zero Core patches — every feature runs through public WordPress hooks.

Built and maintained by [Automattic](https://automattic.com), the company behind WordPress.com, Jetpack, WooCommerce, and Tumblr.

= A real desktop =

* **Windows** — drag, resize, minimize, maximize, snap, tile. Every admin page works, including plugin pages.
* **Dock & taskbar** — the admin menu becomes an icon dock; open windows live in a macOS-style taskbar.
* **Virtual desktops (Spaces)** — one desktop for writing, another for the store, another for moderation.
* **Files on the desktop** — drop posts, media, and links onto the wallpaper, organize them into folders, trash them to the Trash.
* **Session restore** — reload the browser and every window comes back exactly where you left it.

= Make it yours =

* **Wallpapers** — color presets, animated scenes, or your own image.
* **Widgets & desktop icons** — pin live widgets and shortcuts to the wallpaper; plugins can register their own.

= Superpowers =

* **AI Assistant (optional)** — press Cmd+K and ask *"Which post had the comment asking for the recipe?"* It searches your own content. Requires an AI provider configured in **Settings → Connectors** (WordPress 7.0+); see "External services" below.
* **Corkboard** — an interactive, zoomable map of how your posts, pages, and products link together.
* **Cross-window drag & drop** — drag an image from the Media Library window straight into the editor in another window.
* **Command palette** — the full WordPress command palette plus slash commands from plugins, all under Cmd+K.

= Built to be extended =

Every significant behavior is hookable. Register windows, dock items, wallpapers, widgets, desktop icons, commands, settings tabs, and AI tools from your own plugin — stable `openstation_register_*` PHP APIs, a typed JavaScript API, and copy-paste examples in the [developer docs on GitHub](https://github.com/WordPress/openstation/tree/trunk/docs).

= External services =

This plugin's optional **AI Assistant** sends data to the **AI provider you configure in WordPress's Settings → Connectors** (for example OpenAI, Anthropic, or Google). Generation is routed through WordPress 7.0's built-in AI Client, which supplies the credentials stored in Connectors — the plugin never handles an API key itself. With no provider configured in Connectors, no external AI requests are made.

When the AI Assistant is enabled and a user invokes it (via Cmd+K or the slash-command palette):

* **What is sent:** the user's prompt, the conversation history for the active session, and tool-call metadata. The plugin's built-in tools (`search_posts`, `search_pages`, `search_comments`) run WordPress's native keyword search and may include excerpts of the matching posts/pages/comments in tool results, which are then sent back to the provider as part of the agentic loop.
* **When it is sent:** on user-initiated AI requests, and (if an administrator enables "Score new comments with AI") on comment-save hooks for spam analysis. Posts, pages, and taxonomy terms are not sent automatically.
* **Why it is sent:** to obtain model completions and tool-call decisions that drive the AI Assistant.
* **Who provides the service:** whichever provider you configured in Settings → Connectors. Which provider (and endpoint) receives the data depends entirely on that configuration — review the chosen provider's own terms and privacy policy (e.g. OpenAI, Anthropic, or Google).

No other external services are contacted by this plugin.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/`, or install via **Plugins → Add New → Upload Plugin**.
2. Activate the plugin through the **Plugins** screen in WordPress.
3. Click the **desktop** icon in the admin bar's top-right corner. The admin reloads inside the desktop shell.
4. Click the same icon again at any time to return to the classic admin.

= Optional: enable the AI Assistant =

1. In **Settings → Connectors**, set up an AI provider (OpenAI, Anthropic, or Google). Requires WordPress 7.0+.
2. In OpenStation, open **OpenStation Preferences → Features** and turn on **AI assistant** (it's off by default).
3. Press **Cmd+K** (or **Ctrl+K**) anywhere in OpenStation to open the AI assistant.

== Frequently Asked Questions ==

= Does this change anything for users who don't opt in? =

No. The classic admin is untouched until a user toggles OpenStation on for themselves. Deactivating the plugin restores vanilla Core exactly.

= Does the plugin require an external service to function? =

No. The desktop shell, windowing, dock, taskbar, virtual desktops, widgets, wallpapers, and all extension APIs work entirely on-site. The AI Assistant is the only feature that contacts an external service, and it stays inert until an administrator configures an AI provider in Settings → Connectors. See "External services" in the description.

= Does it patch WordPress core? =

No. Every feature is wired through public WordPress actions and filters.

= How do I disable OpenStation for my user? =

Click the desktop icon in the admin bar a second time to flip the toggle off. The plugin can also be deactivated globally from the Plugins screen.

= Where is the developer documentation? =

In `docs/` inside the plugin, and on [GitHub](https://github.com/WordPress/openstation/tree/trunk/docs). The hook reference, JavaScript reference, bridge protocol, and copy-paste examples all live there.

== Screenshots ==

1. Real multitasking — Users, Media, and content editing open side by side as windows.
2. Your admin, your desktop — custom wallpapers and live widgets registered by plugins.
3. The AI Assistant (Cmd+K) answers questions about your own posts, pages, and comments.
4. Corkboard — an interactive map of how your content links together.
5. OpenStation Preferences — pick a wallpaper preset, an animated scene, or upload your own image.
6. Files on the desktop — drag posts, media, and links onto the wallpaper and into folders.
7. The Trash collects trashed posts, media, folders, and shortcuts in one window.

== Credits ==

OpenStation is brought to you by [Automattic](https://automattic.com). The plugin is open source under GPLv2-or-later; contributions are welcome on [GitHub](https://github.com/WordPress/openstation).

= Third-party libraries =

The plugin bundles the following third-party JavaScript library, loaded on demand only when a feature that needs it is in use:

* **[PixiJS](https://pixijs.com/)** (MIT License) — used by the interactive **OpenStation Preferences → About** scene, the **Corkboard** window, built-in canvas wallpapers (e.g. the animated WordPress logo), and the **Inkfall** typing game. PixiJS is loaded from the plugin's own `assets/vendor/` directory; no CDN requests are made.

= Data files =

The **Inkfall** game's word list (`assets/games/inkfall/words.txt`) is generated from the following sources (attribution also ships in the file's header):

* **[FrequencyWords](https://github.com/hermitdave/FrequencyWords)** by Hermit Dave (CC-BY-SA 4.0) — English word-frequency ranking derived from the OpenSubtitles corpus.
* **[english-words](https://github.com/dwyl/english-words)** by dwyl (Unlicense) — used as a validity filter.
* **[LDNOOBW English list](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)** (CC-BY 4.0) — used as an exclusion filter.

== Changelog ==

= 1.0.0 =
* Desktop Mode is now OpenStation — new name, new look, same plugin. Settings, files, sessions and desktop layouts carry over untouched.
* The site folder is now WP Explorer, and OS Settings is now OpenStation Preferences.
* A new palette and typography, with four wallpapers: Galaxy (the new default), Space, Holomesh and Pulsemesh.
* Desktop Mode (Legacy) — a built-in desktop theme that puts the previous look back in one click, WordPress blue included.
* Mio — a soft-body desk companion that drifts across the wallpaper and gets pushed around by your windows. Off by default; turn it on from the dock. It also ships as a standalone script you can drop on any page, WordPress or not.
* Holographic controls — switches, primary buttons and selected items catch an iridescent mesh on hover and press.
* New Switch component, and a searchable Components tab in OpenStation Preferences.
* Select more than one thing at a time — click, Ctrl-click, Shift-click, marquee and Cmd+A on the desktop and in every folder window, with WordPress's own bulk actions and multi-item drag.
* Custom post types now appear in WP Explorer, grouped into a folder named after the plugin or theme that registered them.
* Post tiles show their featured image instead of a generic icon, which turns a catalogue into a photo grid.
* WooCommerce — Orders, Products, Coupons and Customers as browsable folders, with out-of-stock, low-stock, backorder and sale ribbons, and a details pane showing price, stock, order totals, line items and coupon usage.
* Open a customer for their lifetime spend, what they buy most and their recent orders, and follow a product to its buyers or a coupon to who redeemed it.
* The editor's preview companion follows your typing in the classic editor too, and opens straight away instead of waiting on a save.
* Plugins can accept files dropped onto their own desktop icon, via `wp.os.files.registerTilePayloadHandler()`.
* The Games leaderboard refreshes the moment a run finishes, instead of waiting for a reload.
* Fix the Media Library's uploader button opening a window instead of the inline uploader, and uploaded files not reaching the grid until the window was reopened.
* Fix context menus opened near the bottom of the screen running off the edge, which put most of their options out of reach.
* Fix Quick Edit and Bulk Edit going dead once a list refreshed in place.
* Fix the classic revisions screen opening in a browser tab instead of a window, and restoring a revision leaving a stale editor behind.
* Fix closed windows reappearing after a refresh, and window state being lost when several windows were closed in quick succession.
* Fix the widget column rendering empty.
* Desktop icons and file tiles now fade out in Overview, so they no longer collide with window thumbnails.
* Fix `wp.os.activity.subscribe()` never receiving events — channel names containing a slash were silently rejected.
* The portal URL moved from `/desktop-mode/` to `/openstation/`. Reinstall the app if you added OpenStation to your home screen.
* For plugin authors: `wp.desktop` is now `wp.os`, `<wpd-*>` components are `<os-*>`, PHP functions and hooks use the `openstation_` prefix, and activity channels moved from `desktop-mode/<event>` to `os/<event>`. Stored data — options, meta, custom tables, REST namespaces and the WordPress.org slug — is unchanged.

= 0.9.8 =
* Desktop Themes — uploadable ZIP theme system
* Add a Drafts widget
* Add a window corner-radius setting (Sharp / Default / Round)
* Add editor-preview eye button with live split-view preview
* Correct the AI Copilot and settings tab references
* Update wp-coding-standards/wpcs to 3.4.1
* Strip version-history annotations across PHP, TS, and Markdown
* Fix invisible context menus and confirm dialogs (transparent panel background)
* Let a desktop theme recommend OS settings
* Fix window id plumbing, and restore native windows across a reload
* Decode html entities in post excerpts
* Fix Recycle Bin Sync
* Add Aero Peek preview with snap-back to dock peek
* Fix Cmd+K entity search not finding posts in Commands mode
* Make the command palette follow the active desktop theme
* Redesign the native Comments window as a two-pane conversation view
* Keep menu edit links inside the current window
* Name desktop objects after things, not after the software
* Give tooltips their own two theming tokens
* Add an AI writing assistant to the Drafts widget
* Fix active tab underline highlight in Appearance Add Theme view
* Show the whole component kit in OpenStation Preferences, and make it searchable
* Expose dock glyph and focused window control colours as tokens
* Overview: show minimized windows in grid to fix badge count mismatch
* Decode html entities in recycle bin
* Add an admin-bar presentation mode to OpenStation Preferences and the theme system
* AI Agents framework: agents as WordPress users, abilities runner, chat with persisted conversations, drag & drop and Send to triggers
* Close privilege-escalation and session-bypass paths
* Enforce strict structured-output schemas at the provider boundary
* Add window reveal animations
* Add Popup Siege as a OpenStation game extension
* Add SOL Inbound Monologue RSS reader extension
* Drop the esbuild CSS syntax warning in the drafts widget
* Improve the agents chat and Agents section UX
* Contain window-reveal play failures and stop over-promising `owner`
* Enhance agent capabilities and HTTP timeout management
* Provider robustness — OpenAI strict schema, Anthropic refusals, retries, real request timeout

= 0.9.7 =
* Add Drafts widget
* Add Focus Timer widget
* Fix window title bar pushed off-screen during top-edge resize
* Enforce viewport boundaries during window resize
* Fix hiding a dock-placed native window's tile via Apps & Icons
* Fix window dragging allowing windows to disappear off right/bottom edges
* Folder-upload desktop refresh + inline upload previews
* Reset the plugin-update notifiers live after updates run
* Decode html entities in widget titles
* Fix window drag bounds
* Focus Timer: react to the linked window closing
* Make the games framework an opt-in Extended option (off by default)
* Cut idle server load, boot weight, and package size
* Live-refresh Plugins window after install/activate/deactivate

= 0.9.6 =
* Improved button accessibility and visual feedback by implementing the missing busy spinner and aria-busy attributes on the Button component
* AI assistant as the shell's ⌘K palette (Commands + Ask AI)
* Add pinned notes: paper notes with a pushpin, composed in a Note Pad widget
* Improve minimized window UX with restore support and count badges
* Surface core admin notices once in the desktop shell
* Convert pinned notes into draft posts
* Normalize AI Copilot tool schemas for the provider
* Add a game system: Games hub, unified scoreboard, challenges, and Inkfall
* Keep URL-style menu slugs (ACF) as direct admin links
* Add Alphabet Soup game; generalize game infra out of Inkfall
* Fix 404 from wallpaper Sort By when a synthetic tile is on the desktop
* Fix illegible text fields inside os-modal dialogs
* Fix empty custom-gradient editor after re-selecting the wallpaper
* Add Related-entities title-bar navigation with open PHP/JS filter surface
* Admin bar visibility when fullscreen window is minimized
* Allow selecting window from Overview view
* Show open window indicators for bottom dock tiles
* Add busy state and spinner to os-button
* Redesign session-expiry recovery: one login prompt, in-place recovery
* Fix folder rename not reflected on the desktop until refresh
* Live-refresh list windows on content changes (posts, CPTs, comments, WooCommerce orders)
* Add real file/folder storage on the desktop
* Fix gamepad icon missing from the window title bar (data-URI window icons)
* Fix content graph taxonomy fallback

= 0.9.5 =
* AI Copilot now uses WordPress 7.0 providers: configure a provider once in Settings → Connectors and the assistant uses it — no more per-plugin keys
* AI Copilot tools are now WordPress Abilities, so the assistant works across any configured provider; plugin authors add their own tools with the Abilities API (`openstation_register_ai_tool()` was removed)
* Removed the OpenStation Preferences → AI tab; the per-user "AI assistant" toggle now lives in OpenStation Preferences → Features next to "Score new comments with AI"
* Requires WordPress 7.0 for the AI assistant only; on older WordPress the assistant is hidden and the rest of OpenStation is unaffected
* Stored AI keys are deleted from the database on upgrade
* Five new built-in widgets: Recent Comments, Post Stats, Site Views, Jazz Quote, and Starter
* Widgets can now be resized, and docked widget heights persist across sessions
* Two new wallpapers, Living Tree and Snow, plus per-wallpaper settings dialogs
* Window links: windows showing related content are visually connected, with pluggable link renderers for plugin authors
* Spring-loading: hovering a window while dragging anything brings it to the front
* New developer mode setting (OpenStation Preferences → Features) unlocks developer-facing surfaces
* WordPress update notices now surface once in the desktop shell instead of repeating in every window
* Desktop shortcuts stay in sync and core icons follow the spatial layout
* Extended options merged into the OpenStation Preferences → Features tab
* Fixed selection bugs that could point destructive actions at the wrong files
* Closing a window with unsaved changes now warns instead of silently losing work
* Fixed windows and dock state leaking across virtual desktops
* Fixed Overview keyboard navigation and focus trapping
* The dock now refreshes live when a plugin registers a new post type
* Fixed dock icon alignment, "Add New" window titles and icons, and count-label pluralization

= 0.9.3 =
* Rewrite WordPress.org plugin page, leaner copy, video embed, screenshots
* Review: doc/comment accuracy, security hardening, and cleanups across the plugin

= 0.9.2 =
* Persist welcome-dialog dismissal when OpenStation is disabled
* Welcome dialog reappears on every page when the admin is served from an origin that differs from `site_url`

= 0.9.1 =
* Make native list windows opt-in (Beta) instead of opt-out
* Scope AI to comment spam + native-search assistant
* Feat/unfocus window effects
* Fix placement, gear/Help, and dock⇄desktop visibility bugs
* Fix Guidelines-experiment 404 noise, duplicate welcome dialog, and unused-preload warnings
* Add "View activity footprint" row action in Users list

= 0.9.0 =
* Gate per-user REST routes on OpenStation enabled
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
* "Switch to OpenStation" always takes you to the dashboard, so you know where you're starting from
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
* Refactor My WordPress to use `<os-tile>` + add post status ribbons
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
* Faster OpenStation, main bundle cut by 59 %
* "Edit Post" from the front-end admin bar opens nothing
* Cross-page admin-link clicks: state, destructive actions, referer hint
* Warn loudly when a `<os-*>` tag is used without being imported
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
* Native Plugins window + `<os-card>`
* Appearance window polish + dock-peek fixes
* Fix upload theme
* Implement favicon resolver and associated tests for OpenStation
* Auto-inject X-WP-Nonce for REST API requests
* Enhance user management functionality in WordPress REST API
* Fix user role updates
* Fix plugin native issues
* Enhance color scheme preview functionality by adding shell scheme flipping
* Fix rearrange icons out of desktop
* Open each post in its own window
* Add item visibility and dock order settings
* Add first-run welcome dialog for OpenStation
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
* Enhanced AI provider integration: third-party providers may register through `openstation_register_ai_provider()`.
* Title-bar button registry with icon painting for plugin authors.
* OpenStation Preferences tabs are now extensible via `openstation_register_settings_tab_script()` / `openstation_register_settings_tab()`.
* AI Copilot extensibility: server-side tool registry (`openstation_register_ai_tool()`) and client-side `wp.os.ai.ask()` programmatic entry point.
* UI component kit expansion (~25 `<os-*>` web components).
* Backtick hotkey to cycle window focus.
* Unified command palettes via the palette registry.
* OpenStation Preferences Help tab.

= 0.5.0 =
* Command registration APIs (`openstation_register_command_script()` / `openstation_register_command()`) with live install/activate refresh.
* Media-library enhancement enabled by default, with opt-out.
* Dock CSS selectors updated; overflow handling improved.

See the [GitHub releases page](https://github.com/WordPress/openstation/releases) for the full history.

== Upgrade Notice ==

= 0.8.1 =
Framework and stability rework, reworked drag and drop, native Posts/Pages/Users windows, and a new Content Graph tool. Backwards-compatible.

= 0.5.1 =
Adds AI Copilot extensibility (server-side tools, multi-provider support) and a title-bar button registry. Backwards-compatible.
