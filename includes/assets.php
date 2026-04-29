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
 * Registers the desktop mode CSS and JS handles.
 *
 * @since 0.1.0
 */
function desktop_mode_register_assets() {
	$version = DESKTOP_MODE_VERSION;
	$suffix  = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';

	// Styles.
	wp_register_style(
		'wp-desktop-variables',
		DESKTOP_MODE_URL . 'assets/css/variables.css',
		array(),
		$version
	);
	wp_register_style(
		'wp-desktop',
		DESKTOP_MODE_URL . 'assets/css/desktop.css',
		array( 'wp-desktop-variables' ),
		$version
	);
	wp_register_style(
		'wp-desktop-windows',
		DESKTOP_MODE_URL . 'assets/css/windows.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		$version
	);
	wp_register_style(
		'wp-desktop-dock',
		DESKTOP_MODE_URL . 'assets/css/dock.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		$version
	);
	wp_register_style(
		'wp-desktop-chromeless',
		DESKTOP_MODE_URL . 'assets/css/chromeless.css',
		array( 'wp-desktop' ),
		$version
	);

	wp_register_style(
		'wp-desktop-ai-assistant',
		DESKTOP_MODE_URL . 'assets/css/ai-assistant.css',
		array( 'wp-desktop-variables' ),
		$version
	);

	wp_register_style(
		'wp-desktop-code-editor',
		DESKTOP_MODE_URL . 'assets/css/code-editor.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		$version
	);

	// `filemtime` instead of the plugin-wide `$version` for the
	// recycle-bin CSS — this file iterates faster than the bundle
	// and we never want a stale CSS cache to mask a real fix.
	$recycle_bin_css = DESKTOP_MODE_DIR . 'assets/css/recycle-bin.css';
	wp_register_style(
		'wp-desktop-recycle-bin',
		DESKTOP_MODE_URL . 'assets/css/recycle-bin.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		file_exists( $recycle_bin_css ) ? (string) filemtime( $recycle_bin_css ) : $version
	);

	$cron_manager_css = DESKTOP_MODE_DIR . 'assets/css/cron-manager.css';
	wp_register_style(
		'wp-desktop-cron-manager',
		DESKTOP_MODE_URL . 'assets/css/cron-manager.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		file_exists( $cron_manager_css ) ? (string) filemtime( $cron_manager_css ) : $version
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
		'wp-desktop',
		DESKTOP_MODE_URL . 'assets/js/desktop' . $suffix . '.js',
		// `heartbeat` + `jquery` — the recycle-bin badge module
		// (loaded as part of this bundle) opts into the WordPress
		// Heartbeat API so the count tile / desktop-icon badge
		// stays in sync even when the bin window is closed.
		array( 'wp-hooks', 'wp-i18n', 'heartbeat', 'jquery' ),
		$version,
		true
	);

	// `wp-desktop-iframe-bridge` — opt-in iframe-side bridge that
	// provides `wp.desktop.iframe.publish/subscribe/onConnection/
	// requestConnection` to any same-origin iframe that enqueues it.
	// Same code is also injected inline by the chromeless bridge
	// (so chromeless wp-admin pages don't need a separate enqueue)
	// and auto-injected when a native window opts in via
	// `iframeContent: { bridge: true }`. Plugins targeting their
	// own iframe pages just enqueue this handle.
	wp_register_script(
		'wp-desktop-iframe-bridge',
		DESKTOP_MODE_URL . 'assets/js/iframe-bridge' . $suffix . '.js',
		array(),
		$version,
		true
	);

	// `wp-desktop-code-editor` — Monaco-backed code editor app. Loaded
	// lazily by the native-window sync the first time the editor window
	// opens; registers a render callback on
	// `window.wpDesktopNativeWindows['wpdc-editor']`. The script itself
	// is small (file tree + REST glue + Monaco bootstrap shim) — Monaco
	// is loaded separately at runtime from `assets/vendor/monaco-editor`.
	wp_register_script(
		'wp-desktop-code-editor',
		DESKTOP_MODE_URL . 'assets/js/code-editor' . $suffix . '.js',
		array( 'wp-i18n' ),
		$version,
		true
	);
	wp_set_script_translations(
		'wp-desktop-code-editor',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `wp-desktop-recycle-bin` — small bundle for the Recycle Bin
	// native window. Lazy-loaded by the native-window sync the first
	// time the bin opens; registers a render callback on
	// `window.wpDesktopNativeWindows['wpdm-recycle-bin']`.
	$recycle_bin_js = DESKTOP_MODE_DIR . 'assets/js/recycle-bin' . $suffix . '.js';
	wp_register_script(
		'wp-desktop-recycle-bin',
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
		'wp-desktop-recycle-bin',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// `wp-desktop-cron-manager` - native window for browsing and
	// managing WP-Cron events. Lazy-loaded by the native-window sync
	// the first time `wpdm-cron-manager` opens.
	$cron_manager_js = DESKTOP_MODE_DIR . 'assets/js/cron-manager' . $suffix . '.js';
	wp_register_script(
		'wp-desktop-cron-manager',
		DESKTOP_MODE_URL . 'assets/js/cron-manager' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $cron_manager_js ) ? (string) filemtime( $cron_manager_js ) : $version,
		true
	);
	wp_set_script_translations(
		'wp-desktop-cron-manager',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);

	// Wire the translation bundle to this script handle. WP looks
	// for `languages/desktop-mode-{locale}-wp-desktop.json` and
	// injects its `locale_data` into `wp.i18n` just before the
	// script runs — so every `__()` call resolves to the right
	// language without any runtime fetch.
	wp_set_script_translations(
		'wp-desktop',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);
}
add_action( 'init', 'desktop_mode_register_assets' );
