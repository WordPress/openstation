=== WP Desktop Mode ===
Contributors: allterraindeveloper, epeicher
Tags: desktop, admin, ui, productivity, ai
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.5.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Reimagines the WordPress admin as a desktop OS — draggable, resizable, minimizable windows on a desktop, with a dock. Purely opt-in per user.

== Description ==

WP Desktop Mode renders /wp-admin as a desktop operating system. Admin screens open as draggable, resizable, minimizable windows on a desktop, with a left-edge dock built from the admin menu. The classic admin stays untouched for everyone else, and deactivating the plugin restores vanilla Core exactly.

Zero Core patches. Every feature is wired through public WordPress hooks.

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

WP Desktop Mode is built to be extended. Every significant behavior is hookable — add a desktop icon, register a dock item, gate desktop mode by role, react to window events, or register a native window, all from your own plugin with zero patches here.

Comprehensive PHP and JavaScript hook surface, plus stable `wp_register_desktop_*` functions for windows, widgets, wallpapers, icons, window tabs, commands, settings tabs, and AI tools. See the [developer docs on GitHub](https://github.com/WordPress/desktop-mode/tree/trunk/docs).

= External services =

This plugin's optional **AI Copilot** sends data to **OpenAI** (`https://api.openai.com/v1/responses`) when, and only when, an administrator configures an OpenAI API key in **Settings → AI**. With no key configured, no external requests are made.

When the AI Copilot is enabled and a user invokes it (via Cmd+K or the slash-command palette):

* **What is sent:** the user's prompt, the conversation history for the active session, the chosen model identifier (e.g. `gpt-4o-mini`), and tool-call metadata. The plugin's built-in tools (`search_posts`, `search_pages`, `search_comments`) may include excerpts of the matching posts/pages/comments in tool results, which are then sent back to OpenAI as part of the agentic loop.
* **When it is sent:** on user-initiated AI requests, and (if enabled) on `save_post`, term-save, and comment-save hooks for auto-analysis. Auto-analysis runs server-side as part of the post-save flow.
* **Why it is sent:** to obtain model completions and tool-call decisions that drive the AI Copilot.
* **Who provides the service:** OpenAI, L.L.C. — see the [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/) and the [OpenAI Privacy Policy](https://openai.com/policies/row-privacy-policy/).

The AI Copilot's provider layer is also extensible: third-party plugins may register additional providers via `wp_register_desktop_ai_provider()`. Those providers may send data to other endpoints; review each plugin's own privacy disclosure separately.

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

== Changelog ==

= 0.5.1 =
* Code editor and framework improvements.
* Enhanced AI provider integration: third-party providers may register through `wp_register_desktop_ai_provider()`.
* Title-bar button registry with icon painting for plugin authors.
* OS Settings tabs are now extensible via `wp_desktop_register_settings_tab_script()` / `wp_register_desktop_settings_tab()`.
* AI Copilot extensibility: server-side tool registry (`wp_register_desktop_ai_tool()`) and client-side `wp.desktop.ai.ask()` programmatic entry point.
* UI component kit expansion (~25 `<wpd-*>` web components).
* Backtick hotkey to cycle window focus.
* Unified command palettes via the palette registry.
* OS Settings Help tab.

= 0.5.0 =
* Command registration APIs (`wp_desktop_register_command_script()` / `wp_register_desktop_command()`) with live install/activate refresh.
* Media-library enhancement enabled by default, with opt-out.
* Dock CSS selectors updated; overflow handling improved.

See the [GitHub releases page](https://github.com/WordPress/desktop-mode/releases) for the full history.

== Upgrade Notice ==

= 0.5.1 =
Adds AI Copilot extensibility (server-side tools, multi-provider support) and a title-bar button registry. Backwards-compatible.
