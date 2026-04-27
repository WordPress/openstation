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
function wpdm_register_assets() {
	$version = WPDM_VERSION;
	$suffix  = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';

	// Styles.
	wp_register_style(
		'wp-desktop-variables',
		WPDM_URL . 'assets/css/variables.css',
		array(),
		$version
	);
	wp_register_style(
		'wp-desktop',
		WPDM_URL . 'assets/css/desktop.css',
		array( 'wp-desktop-variables' ),
		$version
	);
	wp_register_style(
		'wp-desktop-windows',
		WPDM_URL . 'assets/css/windows.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		$version
	);
	wp_register_style(
		'wp-desktop-dock',
		WPDM_URL . 'assets/css/dock.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		$version
	);
	wp_register_style(
		'wp-desktop-chromeless',
		WPDM_URL . 'assets/css/chromeless.css',
		array( 'wp-desktop' ),
		$version
	);

	wp_register_style(
		'wp-desktop-ai-assistant',
		WPDM_URL . 'assets/css/ai-assistant.css',
		array( 'wp-desktop-variables' ),
		$version
	);

	wp_register_style(
		'wp-desktop-code-editor',
		WPDM_URL . 'assets/css/code-editor.css',
		array( 'wp-desktop-variables', 'dashicons' ),
		$version
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
		WPDM_URL . 'assets/js/desktop' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
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
		WPDM_URL . 'assets/js/iframe-bridge' . $suffix . '.js',
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
		WPDM_URL . 'assets/js/code-editor' . $suffix . '.js',
		array( 'wp-i18n' ),
		$version,
		true
	);
	wp_set_script_translations(
		'wp-desktop-code-editor',
		'desktop-mode',
		WPDM_DIR . 'languages'
	);

	// Wire the translation bundle to this script handle. WP looks
	// for `languages/desktop-mode-{locale}-wp-desktop.json` and
	// injects its `locale_data` into `wp.i18n` just before the
	// script runs — so every `__()` call resolves to the right
	// language without any runtime fetch.
	wp_set_script_translations(
		'wp-desktop',
		'desktop-mode',
		WPDM_DIR . 'languages'
	);
}
add_action( 'init', 'wpdm_register_assets' );
