<?php
/**
 * Desktop Mode — The built-in "Legacy" desktop theme.
 *
 * Legacy is Desktop Mode's own default look, written down: every
 * design token the shell and the `<wpd-*>` component kit read, at the
 * value it resolved to with no theme active when the snapshot was
 * taken. Wearing it changes (almost) nothing — that is the point. It
 * exists so a theme author can read the whole palette in one file,
 * fork it, and change the ten values they care about instead of
 * rediscovering 377 fallback literals scattered across the
 * stylesheets.
 *
 * It ships as data, in `assets/desktop-themes/legacy/theme.json` —
 * the same `theme.json` an uploaded ZIP carries, registered through
 * the same public API a plugin would use
 * ({@see desktop_mode_register_desktop_theme()}) and put through the
 * same sanitizer. `bin/package-legacy-theme.sh` zips that directory
 * into the distributable a user could hand to someone else.
 *
 * ## It is frozen
 *
 * The manifest is a snapshot and stays one. Nothing recompiles it
 * from the stylesheets — not this file, not the build, not CI. When
 * the shell's own defaults move on, Legacy goes on declaring what it
 * declares today, which is the whole reason someone would wear it:
 * they asked for the old look and they keep it. Drifting it with the
 * code would quietly turn the theme into a no-op again.
 * `bin/build-legacy-theme-manifest.mjs` (run bare) reports how far
 * today's defaults have moved from the snapshot; minting a second
 * snapshot means a NEW theme under a new id, never a rewrite of this
 * one.
 *
 * Because it is code-registered rather than uploaded, it is always
 * present and cannot be deleted: the delete route only ever touches
 * the uploaded index ({@see desktop_mode_desktop_theme_delete()}). A
 * site that genuinely does not want it calls
 * `desktop_mode_unregister_desktop_theme( 'desktop-mode/legacy' )` on
 * `init` at a priority above 5.
 *
 * ## What Legacy deliberately does NOT declare
 *
 * Three families, each because naming a literal would make the theme
 * differ from the unthemed shell rather than reproduce it:
 *
 *   - Anything that follows `--wp-admin-theme-color`. The accent, the
 *     focused title bar, the window-link splines and the selection
 *     ring track the user's WordPress admin colour scheme; a hex here
 *     would pin every scheme to Fresh blue.
 *   - Context-dependent tokens — `--desktop-mode-fg`,
 *     `--desktop-mode-tooltip-bg` and friends read light on the desk
 *     and dark inside a window, so one value breaks one of the two.
 *   - Derived sizes (the badge family) and the texture slots, which
 *     are written by the manifest's `textures` block, not `tokens`.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** Manifest id of the built-in Legacy theme. */
const DESKTOP_MODE_LEGACY_THEME_ID = 'desktop-mode/legacy';

/**
 * Absolute path of the Legacy theme's `theme.json`.
 *
 * @return string
 */
function desktop_mode_legacy_theme_manifest_path() {
	/**
	 * Filters the path the built-in Legacy theme's manifest is read
	 * from. A site that has forked the token set can point this at
	 * its own `theme.json` without touching the registration.
	 *
	 * @param string $path Absolute path to a `theme.json`.
	 */
	return (string) apply_filters(
		'desktop_mode_legacy_theme_manifest_path',
		DESKTOP_MODE_DIR . 'assets/desktop-themes/legacy/theme.json'
	);
}

/**
 * Read the Legacy theme's token map off disk.
 *
 * Statically cached: the manifest is data that cannot change inside a
 * request, and the file is read at most once even if something calls
 * the registration twice.
 *
 * @return array<string,string> Map of custom property => value, or an
 *                              empty array when the file is missing
 *                              or unreadable.
 */
function desktop_mode_legacy_theme_tokens() {
	static $tokens = null;
	if ( null !== $tokens ) {
		return $tokens;
	}

	$tokens = array();
	$path   = desktop_mode_legacy_theme_manifest_path();
	if ( ! is_readable( $path ) ) {
		return $tokens;
	}

	$manifest = wp_json_file_decode( $path, array( 'associative' => true ) );
	if ( is_array( $manifest ) && isset( $manifest['tokens'] ) && is_array( $manifest['tokens'] ) ) {
		$tokens = $manifest['tokens'];
	}
	return $tokens;
}

/**
 * Register the built-in desktop themes.
 *
 * Priority 5 on `init`, the same slot the built-in wallpapers use, so
 * the theme is in the registry before the shell config is built and
 * before any third-party plugin reacting to
 * `desktop_mode_desktop_theme_registered` runs.
 *
 * The name and description are duplicated between here and the
 * manifest on purpose: PHP's copy is translatable, the manifest's is
 * what a user sees if they install the ZIP on a site that does not
 * run Desktop Mode's own registration. Keep the two in step.
 *
 * @return void
 */
function desktop_mode_register_builtin_desktop_themes() {
	$tokens = desktop_mode_legacy_theme_tokens();
	if ( empty( $tokens ) ) {
		return;
	}

	desktop_mode_register_desktop_theme(
		DESKTOP_MODE_LEGACY_THEME_ID,
		array(
			'name'        => __( 'Desktop Mode (Legacy)', 'desktop-mode' ),
			'version'     => '1.0.0',
			'author'      => 'Desktop Mode',
			'description' => __( "Desktop Mode's own defaults, written down. Every design token the shell and the component kit read, at the value they resolve to with no theme active. Nothing to look at — a starting point to fork.", 'desktop-mode' ),
			// A code theme's assets are URLs it already serves. The
			// artwork is the theme previewing itself: desk, dock and
			// one window, painted in the tokens below.
			'preview'     => DESKTOP_MODE_URL . 'assets/desktop-themes/legacy/preview.svg',
			'tokens'      => $tokens,
		)
	);
}

/*
 * Gated the same way the admin-rendering modules are: nothing on a
 * frontend page view can consult the theme registry, and reading +
 * sanitizing + compiling 377 tokens for a request that will never
 * render the shell is pure waste.
 */
if ( desktop_mode_request_needs_admin_modules() ) {
	add_action( 'init', 'desktop_mode_register_builtin_desktop_themes', 5 );
}
