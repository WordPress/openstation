=== OpenStation: Desktop Windows, Dock & Virtual Desktops for WP Admin ===
Contributors: automattic, allterraindeveloper, epeicher, mmtr86, nickhamze
Tags: admin, dashboard, desktop, productivity, ai
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A windowed workspace for wp-admin. Open posts, media, and settings side by side, with a dock, virtual desktops, and a Cmd+K palette.

== Description ==

**wp-admin forgets. OpenStation doesn't.**

You know the moment. You're deep in a post and you need one image from the Media Library. You click over, find it, click back, and everything you had going is gone. Your scroll position, your half-typed thought, the three other things you had queued up in your head.

That's not a bug you hit. That's the design. wp-admin shows you one screen at a time, and every navigation throws the last one away. It has worked this way since 2003, like a fridge that empties itself every time you close the door.

WordPress has rebuilt almost everything else. The editor, the site editor, the patterns, the styles. The admin's one-screen-at-a-time model is the layer nobody touched.

OpenStation touches it.

https://www.youtube.com/watch?v=jii_gGbqUx4

Install it and admin screens become draggable, resizable windows. Edit a post while the Media Library sits open next to it. Drag an image from one window straight into the other. Keep comments open in the corner. Reload the browser and your window layout — open pages, positions, sizes, and window states — comes back where you left it.

OpenStation itself is free, GPL, and opt-in per user. One click in the admin bar turns it on for you. One click turns it off. Nobody else on your site sees anything change, and deactivating the plugin restores the classic admin exactly. No Core patches and no lock-in. Optional AI providers may charge for their service.

Built and maintained by [Automattic](https://automattic.com), the company behind WordPress.com, Jetpack, WooCommerce, and Tumblr.

= Work on more than one thing at once =

Admin pages open as windows, including pages added by most other plugins. Drag them, resize them, snap them, tile them, minimize them to a taskbar. The admin menu becomes a dock of icons. Two editors open at once is one click away.

= Never lose your place =

Moving between open windows leaves each page in place. Across reloads, OpenStation remembers your open pages, window positions, sizes and states, virtual desktops, and focus. Closing a window with unsaved changes warns you first.

= A desk you can actually put things on =

Drop posts, media, and links right onto the wallpaper. Sort them into folders. Trash them to a Trash that actually holds things. The stuff you're working on this week can just sit out where you can see it.

= One desktop per job =

Virtual desktops, the way your operating system does them. One for writing. One for the store. One for comment triage. One for that redesign you keep poking at. Switch between them without closing anything.

= Find anything with Cmd+K =

The full WordPress command palette, plus slash commands from your plugins, all under one keystroke. Turn on the optional AI assistant and you can ask it things like "which post had the comment asking for the recipe?" and it searches your own content to answer. (Requires an AI provider configured in Settings → Connectors on WordPress 7.0+. Details under "External services" below.)

= See how your site fits together =

The Corkboard is an interactive, zoomable map of how your posts, pages, and products link to each other. Pan around it. Find the orphans. Find the hubs.

= Running a store? =

Orders, Products, Coupons, and Customers become browsable folders with stock and sale ribbons. Open a customer to see their lifetime spend and what they buy most. Follow a product to its buyers, or a coupon to who redeemed it.

= Make it yours =

Wallpapers, from color presets to animated scenes to your own photo. Live widgets pinned to the desktop: drafts, stats, recent comments, a focus timer. Uploadable desktop themes, including a built-in Legacy theme that brings the old WordPress blue back in one click. And Mio, a soft-body desk companion that drifts across your wallpaper and gets bumped around by your windows. Off by default. You'll turn it on.

= For developers =

Extend OpenStation through documented PHP and JavaScript APIs. Register windows, icons, wallpapers, widgets, commands, and settings tabs through stable `openstation_register_*` PHP APIs and a typed JavaScript API; customize dock items through documented hooks; add AI tools with the WordPress Abilities API. Copy-paste examples live in the [developer docs on GitHub](https://github.com/WordPress/openstation/tree/trunk/docs).

= External services =

No external service is required for OpenStation's desktop interface. The optional AI Assistant and two user-initiated enrichment features make the external requests described below.

**AI Assistant**

The optional AI Assistant sends data to the **AI provider you configure in WordPress's Settings → Connectors** (for example OpenAI, Anthropic, or Google). Generation is routed through WordPress 7.0's built-in AI Client, which supplies the credentials stored in Connectors. The plugin never handles an API key itself. With no provider configured in Connectors, no external AI requests are made.

When the AI Assistant is enabled and a user invokes it (via Cmd+K or the slash-command palette):

* **What is sent:** the user's prompt, the conversation history for the active session, and tool-call metadata. The plugin's built-in tools (`search_posts`, `search_pages`, `search_comments`) run WordPress's native keyword search and may include excerpts of the matching posts/pages/comments in tool results, which are then sent back to the provider as part of the agentic loop.
* **When it is sent:** on user-initiated AI requests, and (if an administrator enables "Score new comments with AI") on comment-save hooks for spam analysis. Posts, pages, and taxonomy terms are not sent automatically.
* **Why it is sent:** to obtain model completions and tool-call decisions that drive the AI Assistant.
* **Who provides the service:** whichever provider you configured in Settings → Connectors. Which provider (and endpoint) receives the data depends entirely on that configuration. Review the chosen provider's own terms and privacy policy (e.g. OpenAI, Anthropic, or Google).

**URL shortcut favicons**

When an authorized user creates a desktop shortcut to an external URL, OpenStation asks that URL for its page HTML and favicon so the shortcut can display the site's icon. The request is made from your WordPress server and sends the requested URL, the server's IP address, an OpenStation user-agent string, and normal HTTP request metadata to the operator of that site. This happens only when a user creates the shortcut. The destination site's terms and privacy policy apply.

**WordPress.org plugin information**

When an authorized user opens or refreshes parts of OpenStation's Plugins window, OpenStation may request public plugin details, update metadata, and review excerpts from WordPress.org. These requests send plugin slugs, the site's locale, and normal HTTP request metadata to WordPress.org. This information is used only to display and manage plugins. Review the [WordPress.org Privacy Policy](https://wordpress.org/about/privacy/).

OpenStation's OAuth relay does not contact a service by itself. Third-party plugins that configure the relay may contact their own providers and are responsible for disclosing those services.

== Installation ==

1. Install via **Plugins → Add New** (search for "OpenStation"), or upload the plugin folder to `/wp-content/plugins/`.
2. Activate the plugin through the **Plugins** screen.
3. Click the **desktop** icon in the admin bar's top-right corner. The admin reloads inside the desktop shell.
4. Click the same icon again at any time to return to the classic admin.

= Optional: enable the AI Assistant =

1. In **Settings → Connectors**, set up an AI provider (OpenAI, Anthropic, or Google). Requires WordPress 7.0+.
2. In OpenStation, open **OpenStation Preferences → Features** and turn on **AI assistant** (it's off by default).
3. Press **Cmd+K** (or **Ctrl+K**) anywhere in OpenStation to open the AI assistant.

== Frequently Asked Questions ==

= Isn't this just a gimmick? =

The desktop look is the visible part, so it's a fair question. But the look is a consequence, and the mechanism underneath is the point: windows hold their state, so switching tasks stops costing you your place. wp-admin is a single-document interface where every navigation destroys the last screen. OpenStation replaces that with the same concurrency model your operating system has used for decades. The research behind it goes back to Henderson and Card's "Rooms" paper at Xerox PARC in 1986. The wallpaper is just what that model looks like when you build it.

= Will this slow down my site? =

OpenStation's desktop interface and browser assets are loaded only inside wp-admin, and only for users who have turned it on. Its PHP integration still participates in normal WordPress request handling where needed, including tracking content changes, but visitors never receive the desktop UI.

= Does this change anything for users who don't opt in? =

No. The classic admin is untouched until a user toggles OpenStation on for themselves. Deactivating the plugin restores vanilla Core exactly.

= Does it work with my other plugins? =

Most plugin admin pages open as windows without special integration. Plugins that depend on running in the top-level browser context or use unusual navigation may need compatibility work. Plugins can also register their own native windows, widgets, and commands for a deeper integration.

= Does the plugin require an external service to function? =

No. The desktop shell, windowing, dock, taskbar, virtual desktops, widgets, wallpapers, and extension APIs work without an external service. The optional AI Assistant requires a configured AI provider. OpenStation also makes limited, user-initiated requests to resolve URL-shortcut favicons and display WordPress.org plugin information. See "External services" in the description.

= Does it patch WordPress core? =

No. Every feature is wired through public WordPress actions and filters.

= How do I turn OpenStation off for my user? =

Click the desktop icon in the admin bar a second time. The plugin can also be deactivated globally from the Plugins screen.

= Where is the developer documentation? =

In `docs/` inside the plugin, and on [GitHub](https://github.com/WordPress/openstation/tree/trunk/docs). The hook reference, JavaScript reference, bridge protocol, and copy-paste examples all live there.

== Screenshots ==

1. Real multitasking: Users, Media, and a post you're editing, open side by side as windows.
2. Your admin, your desktop: custom wallpapers and live widgets registered by plugins.
3. Ask the AI Assistant (Cmd+K) about your own posts, pages, and comments.
4. Corkboard: a zoomable map of how your content links together.
5. OpenStation Preferences: wallpaper presets, animated scenes, or your own image.
6. Files on the desktop: drag posts, media, and links onto the wallpaper and into folders.
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

= 1.0.1 =
* Tile contrast, comments-window styling, Overview clicks, and preview refreshes
* Always show the Agents section in WP Explorer
* Windows: Preserve fullscreen state after leaving Overview
* Decode HTML entities in plugin install toast
* Settle a pending Overview exit before re-entering
* AI: surface an empty final answer as an error instead of a silent success
* Experimental: Set OpenStation windows free into real OS windows (Electron adapter)

= 1.0.0 =
* Desktop Mode is now OpenStation — new name, new look, same plugin. Settings, files, sessions and desktop layouts carry over untouched.
* The site folder is now WP Explorer, and OS Settings is now OpenStation Preferences.
* A new palette and typography, with four wallpapers: Galaxy (the new default), Space, Holomesh and Pulsemesh.
* Desktop Mode (Legacy) — a built-in desktop theme that puts the previous look back in one click, WordPress blue included.
* Mio — a soft-body desk companion that drifts across the wallpaper and gets pushed around by your windows. Off by default; turn it on from the dock.
* Holographic controls, a new Switch component, and a searchable Components tab in OpenStation Preferences.
* Multi-select everywhere: click, Ctrl-click, Shift-click, marquee and Cmd+A, with WordPress's own bulk actions and multi-item drag.
* Custom post types now appear in WP Explorer, grouped by the plugin or theme that registered them.
* Post tiles show their featured image instead of a generic icon.
* WooCommerce — Orders, Products, Coupons and Customers as browsable folders, with stock and sale ribbons, customer lifetime spend, and coupon redemption views.
* The editor's preview companion follows your typing in the classic editor too, and opens straight away instead of waiting on a save.
* Many fixes: Media Library uploads, context menus near the screen edge, Quick Edit after list refreshes, revisions opening in-window, window state across refreshes.
* The portal URL moved from `/desktop-mode/` to `/openstation/`. Reinstall the app if you added OpenStation to your home screen.
* For plugin authors: `wp.desktop` is now `wp.os`, `<wpd-*>` components are `<os-*>`, PHP functions and hooks use the `openstation_` prefix, and activity channels moved to `os/<event>`. Stored data — options, meta, custom tables, REST namespaces and the WordPress.org slug — is unchanged.

= 0.9.8 =
* Desktop Themes — uploadable ZIP theme system
* Drafts widget with an AI writing assistant, window corner-radius setting, live split-view editor preview
* AI Agents framework: agents as WordPress users, abilities runner, chat with persisted conversations
* Redesigned two-pane Comments window, Aero Peek dock previews, window reveal animations
* Security: closed privilege-escalation and session-bypass paths; strict structured-output schemas at the provider boundary
* Many smaller fixes and polish

Earlier releases are on the [GitHub releases page](https://github.com/WordPress/openstation/releases).

== Upgrade Notice ==

= 1.0.0 =
Desktop Mode is now OpenStation. Everything carries over: settings, files, sessions, desktop layouts. Plugin authors: `wp.desktop` is now `wp.os`; see the changelog for the rename map.
