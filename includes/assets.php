<?php
/**
 * Desktop Mode asset registration.
 *
 * Registers all desktop-mode CSS and JS handles with WordPress so they can
 * be enqueued from anywhere in the plugin (or by third parties).
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Cache-buster for a stylesheet that `@import`s sub-sheets: the max
 * `filemtime` across the file AND everything it (transitively) imports.
 * Sub-sheet URLs carry no `?ver=` of their own, so the parent's stamp is
 * the only cache key the browser ever sees for the subtree — it must
 * move when any member changes.
 *
 * @since 0.9.4
 *
 * @param string $relative Stylesheet path relative to the plugin dir.
 * @param string $fallback Version to use when the file is missing.
 * @return string Version string.
 */
function desktop_mode_css_subtree_version( $relative, $fallback ) {
	$root = DESKTOP_MODE_DIR . $relative;
	if ( ! file_exists( $root ) ) {
		return (string) $fallback;
	}
	$max   = (int) filemtime( $root );
	$queue = array( $root );
	$seen  = array( $root => true );
	while ( ! empty( $queue ) ) {
		$file = array_pop( $queue );
		$css  = (string) file_get_contents( $file );
		if ( ! preg_match_all( '/@import\s+url\(\s*["\']?([^"\')\s]+)["\']?\s*\)/i', $css, $matches ) ) {
			continue;
		}
		foreach ( $matches[1] as $import ) {
			$path = dirname( $file ) . '/' . $import;
			if ( ! file_exists( $path ) || isset( $seen[ $path ] ) ) {
				continue;
			}
			$seen[ $path ] = true;
			$max           = max( $max, (int) filemtime( $path ) );
			$queue[]       = $path;
		}
	}
	return (string) $max;
}

/**
 * Registers the desktop mode CSS and JS handles.
 *
 * @since 0.1.0
 */
function desktop_mode_register_assets() {
	$version = DESKTOP_MODE_VERSION;
	$suffix  = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';

	// `filemtime`-stamped version for built bundles. The plugin-wide
	// `DESKTOP_MODE_VERSION` is bumped per release, but the bundles
	// iterate faster — without a per-file mtime stamp, two clients
	// loading the same `?ver=…` URL can be served different bytes
	// (whichever build was on disk at upload time). Stamping with the
	// file's modification time guarantees the URL changes whenever the
	// file does, so "is my fix deployed?" is answerable from the
	// network tab. Falls back to `$version` when the file is missing
	// (test envs that import this file before the build runs).
	$built_version = static function ( $relative ) use ( $version ) {
		$path = DESKTOP_MODE_DIR . $relative;
		return file_exists( $path ) ? (string) filemtime( $path ) : $version;
	};


	// Styles.
	wp_register_style(
		'desktop-mode-variables',
		DESKTOP_MODE_URL . 'assets/css/variables.css',
		array(),
		$version
	);
	// `filemtime`-stamped so the `<link rel="stylesheet">` URL matches the
	// `<link rel="preload" as="style">` hint emitted by
	// `desktop_mode_print_preload_hints()` (which stamps with filemtime).
	// Registering this with the plain `$version` instead produced two
	// different `?ver=` query strings for the same file, so the browser
	// never matched the preload to the stylesheet and logged "preloaded
	// but not used within a few seconds from the window's load event".
	wp_register_style(
		'desktop-mode',
		DESKTOP_MODE_URL . 'assets/css/desktop.css',
		array( 'desktop-mode-variables' ),
		$built_version( 'assets/css/desktop.css' )
	);
	// `filemtime`-stamped — window-chrome iteration (drop overlays,
	// new drag affordances, third-party-plugin compat) lands faster
	// than plugin version bumps. Without an mtime stamp the browser
	// keeps `?ver=<plugin-version>` valid for the whole release cycle
	// and the user keeps seeing yesterday's CSS even after a hard
	// reload.
	//
	// The stamp covers the whole `@import` SUBTREE, not just the parent
	// file: `windows.css` imports `window-chrome.css`,
	// `os-settings.css`, … and those sub-sheet URLs carry no `?ver=` of
	// their own. Stamping only the parent meant an edit to a sub-sheet
	// never changed any URL the browser knew about, so users kept
	// yesterday's rules until an unrelated parent edit came along
	// (exactly how the wallpaper-description card shipped with stale
	// layout). The subtree max-mtime busts the parent whenever ANY
	// sub-sheet changes; the re-parsed parent then re-requests the
	// sub-sheets, whose fresh mtimes fail heuristic-cache reuse.
	wp_register_style(
		'desktop-mode-windows',
		DESKTOP_MODE_URL . 'assets/css/windows.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		desktop_mode_css_subtree_version( 'assets/css/windows.css', $version )
	);
	wp_register_style(
		'desktop-mode-dock',
		DESKTOP_MODE_URL . 'assets/css/dock.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		$built_version( 'assets/css/dock.css' )
	);
	wp_register_style(
		'desktop-mode-dock-peek',
		DESKTOP_MODE_URL . 'assets/css/dock-peek.css',
		array( 'desktop-mode-dock' ),
		$version
	);
	// `filemtime`-stamped — the chromeless overrides iterate faster
	// than the plugin-wide version bumps (per-page compat shims and
	// page-title-action exceptions land in patches), and a stale
	// cached copy means the user sees yesterday's rules. Without the
	// stamp, the browser keeps `?ver=0.8.1` valid for the whole
	// release cycle.
	wp_register_style(
		'desktop-mode-chromeless',
		DESKTOP_MODE_URL . 'assets/css/chromeless.css',
		array( 'desktop-mode' ),
		$built_version( 'assets/css/chromeless.css' )
	);

	// `filemtime`-stamped — the AI assistant surface (error states,
	// inline affordances) iterates faster than plugin version bumps.
	// Without an mtime stamp the browser keeps `?ver=<plugin-version>`
	// valid for the whole release cycle and the user keeps seeing
	// yesterday's CSS even after a hard reload.
	wp_register_style(
		'desktop-mode-ai-assistant',
		DESKTOP_MODE_URL . 'assets/css/ai-assistant.css',
		array( 'desktop-mode-variables' ),
		$built_version( 'assets/css/ai-assistant.css' )
	);

	wp_register_style(
		'desktop-mode-bug-report',
		DESKTOP_MODE_URL . 'assets/css/bug-report.css',
		array( 'desktop-mode-variables' ),
		$version
	);

	// `filemtime` instead of the plugin-wide `$version` for the
	// recycle-bin CSS — this file iterates faster than the bundle
	// and we never want a stale CSS cache to mask a real fix.
	$recycle_bin_css = DESKTOP_MODE_DIR . 'assets/css/recycle-bin.css';
	wp_register_style(
		'desktop-mode-recycle-bin',
		DESKTOP_MODE_URL . 'assets/css/recycle-bin.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $recycle_bin_css ) ? (string) filemtime( $recycle_bin_css ) : $version
	);

	// `filemtime` for the native Posts window CSS — same rationale as
	// the recycle-bin CSS: bundle iterates faster than the plugin
	// version and stale caches are worse than the cost of a 304.
	$posts_window_css = DESKTOP_MODE_DIR . 'assets/css/posts-window.css';
	wp_register_style(
		'desktop-mode-posts-window',
		DESKTOP_MODE_URL . 'assets/css/posts-window.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $posts_window_css ) ? (string) filemtime( $posts_window_css ) : $version
	);

	// Native Plugins window CSS — same `filemtime`-cache-bust posture
	// as the Posts/Recycle Bin styles.
	$plugins_window_css = DESKTOP_MODE_DIR . 'assets/css/plugins-window.css';
	wp_register_style(
		'desktop-mode-plugins-window',
		DESKTOP_MODE_URL . 'assets/css/plugins-window.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $plugins_window_css ) ? (string) filemtime( $plugins_window_css ) : $version
	);

	// Native Comments window CSS — same `filemtime` posture.
	$comments_window_css = DESKTOP_MODE_DIR . 'assets/css/comments-window.css';
	wp_register_style(
		'desktop-mode-comments-window',
		DESKTOP_MODE_URL . 'assets/css/comments-window.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $comments_window_css ) ? (string) filemtime( $comments_window_css ) : $version
	);

	// Files-on-the-Desktop tile + layer styles. `filemtime` for the
	// same reason as the recycle-bin / posts-window CSS: this file
	// iterates faster than the plugin version, and a stale cache
	// would mask a real fix.
	$desktop_files_css = DESKTOP_MODE_DIR . 'assets/css/desktop-files.css';
	wp_register_style(
		'desktop-mode-files',
		DESKTOP_MODE_URL . 'assets/css/desktop-files.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $desktop_files_css ) ? (string) filemtime( $desktop_files_css ) : $version
	);

	// Games hub window (launcher grid, scoreboard, challenges) +
	// per-game styles. Same `filemtime` cache-bust posture as the
	// other fast-iterating feature stylesheets.
	$games_css = DESKTOP_MODE_DIR . 'assets/css/games.css';
	wp_register_style(
		'desktop-mode-games',
		DESKTOP_MODE_URL . 'assets/css/games.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $games_css ) ? (string) filemtime( $games_css ) : $version
	);
	$game_inkfall_css = DESKTOP_MODE_DIR . 'assets/css/game-inkfall.css';
	wp_register_style(
		'desktop-mode-game-inkfall',
		DESKTOP_MODE_URL . 'assets/css/game-inkfall.css',
		array( 'desktop-mode-variables' ),
		file_exists( $game_inkfall_css ) ? (string) filemtime( $game_inkfall_css ) : $version
	);

	// Pinned-notes layer styles (paper, pushpin, pastel tokens, pin
	// animations). Same `filemtime` cache-bust posture as the other
	// fast-iterating feature stylesheets above.
	$notes_css = DESKTOP_MODE_DIR . 'assets/css/notes.css';
	wp_register_style(
		'desktop-mode-notes',
		DESKTOP_MODE_URL . 'assets/css/notes.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $notes_css ) ? (string) filemtime( $notes_css ) : $version
	);

	// Scripts.
	//
	// `wp-hooks` — the shell exposes a WordPress-style filter/action
	// API (`window.wp.hooks`) to third-party plugins.
	// `wp-i18n` — the TS `__()` / `_x()` / `sprintf()` wrappers in
	// `src/i18n.ts` delegate to `window.wp.i18n` for translation
	// lookups. Both handles are core-shipped but only pre-enqueued
	// when Gutenberg-adjacent deps pull them in, so we list them
	// explicitly to guarantee load order.
	wp_register_script(
		'desktop-mode',
		DESKTOP_MODE_URL . 'assets/js/desktop' . $suffix . '.js',
		// `heartbeat` + `jquery` — the recycle-bin badge module
		// (loaded as part of this bundle) opts into the WordPress
		// Heartbeat API so the count tile / desktop-icon badge
		// stays in sync even when the bin window is closed.
		array( 'wp-hooks', 'wp-i18n', 'heartbeat', 'jquery' ),
		$built_version( 'assets/js/desktop' . $suffix . '.js' ),
		true
	);

	// `desktop-mode-iframe-bridge` — opt-in iframe-side bridge that
	// provides `wp.desktop.iframe.publish/subscribe/onConnection/
	// requestConnection` to any same-origin iframe that enqueues it.
	// Same code is also injected inline by the chromeless bridge
	// (so chromeless wp-admin pages don't need a separate enqueue)
	// and auto-injected when a native window opts in via
	// `iframeContent: { bridge: true }`. Plugins targeting their
	// own iframe pages just enqueue this handle.
	wp_register_script(
		'desktop-mode-iframe-bridge',
		DESKTOP_MODE_URL . 'assets/js/iframe-bridge' . $suffix . '.js',
		array(),
		$built_version( 'assets/js/iframe-bridge' . $suffix . '.js' ),
		true
	);

	// `desktop-mode-gutenberg-drop-receiver` — iframe-side bundle
	// enqueued only on the Block Editor screens (`post.php` /
	// `post-new.php`) for desktop-mode users. Listens for
	// `desktop-mode-drop` postMessages from the parent shell (see
	// `src/drag/iframe-drop-targets.ts`) and inserts the matching
	// Gutenberg block via `wp.data.dispatch('core/block-editor')`.
	// Depends on `wp-blocks` + `wp-data` so the editor stores are
	// guaranteed enqueued before the receiver runs its first message
	// handler.
	wp_register_script(
		'desktop-mode-gutenberg-drop-receiver',
		DESKTOP_MODE_URL . 'assets/js/gutenberg-drop-receiver' . $suffix . '.js',
		array( 'wp-blocks', 'wp-data' ),
		$built_version( 'assets/js/gutenberg-drop-receiver' . $suffix . '.js' ),
		true
	);

	// `desktop-mode-recycle-bin` — small bundle for the Recycle Bin
	// native window. Lazy-loaded by the native-window sync the first
	// time the bin opens; registers a render callback on
	// `window.desktopModeNativeWindows['desktop-mode-recycle-bin']`.
	$recycle_bin_js = DESKTOP_MODE_DIR . 'assets/js/recycle-bin' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-recycle-bin',
		DESKTOP_MODE_URL . 'assets/js/recycle-bin' . $suffix . '.js',
		// `heartbeat` + `jquery` — the bin opts in to the WordPress
		// Heartbeat API while its window is open as the catch-all
		// real-time channel for deletes that don't render an admin
		// footer (REST/AJAX/other tabs/WP-CLI). See
		// `src/recycle-bin/realtime.ts` for the subscriber.
		array( 'wp-i18n', 'heartbeat', 'jquery' ),
		file_exists( $recycle_bin_js ) ? (string) filemtime( $recycle_bin_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-recycle-bin',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-games` — bundle for the Games hub native window
	// (launcher grid, scoreboard, challenges client). Lazy-loaded by
	// the native-window sync the first time the hub opens; registers a
	// render callback on
	// `window.desktopModeNativeWindows['desktop-mode-games']`.
	// `heartbeat` + `jquery` — the challenges client rides the
	// WordPress Heartbeat bus for live delivery.
	$games_js = DESKTOP_MODE_DIR . 'assets/js/games' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-games',
		DESKTOP_MODE_URL . 'assets/js/games' . $suffix . '.js',
		array( 'wp-i18n', 'heartbeat', 'jquery' ),
		file_exists( $games_js ) ? (string) filemtime( $games_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-games',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-game-inkfall` — the Inkfall game bundle. Loaded
	// lazily by the games framework on first launch; publishes the
	// game def on `window.desktopModeGames.inkfall`.
	$game_inkfall_js = DESKTOP_MODE_DIR . 'assets/js/game-inkfall' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-game-inkfall',
		DESKTOP_MODE_URL . 'assets/js/game-inkfall' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $game_inkfall_js ) ? (string) filemtime( $game_inkfall_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-game-inkfall',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-posts-window` — small bundle for the native Posts
	// window. Lazy-loaded by the native-window sync the first time the
	// window opens (via the dock-click swap when the user opts in);
	// registers a render callback on
	// `window.desktopModeNativeWindows['desktop-mode-posts']`.
	$posts_window_js = DESKTOP_MODE_DIR . 'assets/js/posts-window' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-posts-window',
		DESKTOP_MODE_URL . 'assets/js/posts-window' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $posts_window_js ) ? (string) filemtime( $posts_window_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-posts-window',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-plugins-window` — small bundle for the native
	// Plugins window. Lazy-loaded by the native-window sync the first
	// time the window opens (via the dock-click swap when the user
	// opts in); registers a render callback on
	// `window.desktopModeNativeWindows['desktop-mode-plugins']`.
	$plugins_window_js = DESKTOP_MODE_DIR . 'assets/js/plugins-window' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-plugins-window',
		DESKTOP_MODE_URL . 'assets/js/plugins-window' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $plugins_window_js ) ? (string) filemtime( $plugins_window_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-plugins-window',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-comments-window` — small bundle for the native
	// Comments window. Lazy-loaded by the native-window sync the first
	// time the window opens (via the dock-click swap when the user
	// opts in); registers a render callback on
	// `window.desktopModeNativeWindows['desktop-mode-comments']`.
	$comments_window_js = DESKTOP_MODE_DIR . 'assets/js/comments-window' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-comments-window',
		DESKTOP_MODE_URL . 'assets/js/comments-window' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $comments_window_js ) ? (string) filemtime( $comments_window_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-comments-window',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-animated-logo-wallpaper` — built-in PixiJS canvas
	// wallpaper, moved out of `desktop.min.js` in 0.8.4. The wallpaper
	// `server-sync` loads this handle when the user selects the
	// `wp-animated-logo` wallpaper (or opens OS Settings → Wallpaper
	// and the picker pulls every registered canvas def in). The
	// bundle's only side effect is publishing the `WallpaperDef` on
	// `window.desktopModeWallpapers['wp-animated-logo']`.
	$animated_logo_js = DESKTOP_MODE_DIR . 'assets/js/animated-logo-wallpaper' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-animated-logo-wallpaper',
		DESKTOP_MODE_URL . 'assets/js/animated-logo-wallpaper' . $suffix . '.js',
		array( 'wp-hooks' ),
		file_exists( $animated_logo_js ) ? (string) filemtime( $animated_logo_js ) : $version,
		true
	);

	// `desktop-mode-snow-wallpaper` — built-in PixiJS canvas
	// wallpaper: snowfall that accumulates on window tops and melts
	// away. Same lazy-load path as the animated logo: the wallpaper
	// `server-sync` injects this handle when the user selects the
	// `wp-snow` wallpaper (or opens OS Settings → Wallpaper and the
	// picker pulls the def in). The bundle's only side effect is
	// publishing the `WallpaperDef` on
	// `window.desktopModeWallpapers['wp-snow']`.
	$snow_js = DESKTOP_MODE_DIR . 'assets/js/snow-wallpaper' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-snow-wallpaper',
		DESKTOP_MODE_URL . 'assets/js/snow-wallpaper' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $snow_js ) ? (string) filemtime( $snow_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-snow-wallpaper',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `desktop-mode-ai-assistant` — AI Copilot spotlight overlay,
	// moved out of `desktop.min.js` in 0.8.4. The main bundle ships a
	// stub matching the public `wp.desktop.ai` contract; the stub
	// `<script>`-injects this handle the first time the user opens
	// the assistant (Cmd+K or admin-bar button).
	$ai_assistant_js = DESKTOP_MODE_DIR . 'assets/js/ai-assistant' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-ai-assistant',
		DESKTOP_MODE_URL . 'assets/js/ai-assistant' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $ai_assistant_js ) ? (string) filemtime( $ai_assistant_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-ai-assistant',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// Wire the translation bundle to this script handle. WP looks
	// for `languages/desktop-mode-{locale}-desktop-mode.json` and
	// injects its `locale_data` into `wp.i18n` just before the
	// script runs — so every `__()` call resolves to the right
	// language without any runtime fetch.
	wp_set_script_translations(
		'desktop-mode',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);
}
add_action( 'init', 'desktop_mode_register_assets' );
