<?php
/**
 * OpenStation — The built-in "Legacy" desktop theme.
 *
 * Legacy is OpenStation's own default look, written down: every
 * design token the shell and the `<os-*>` component kit read, at the
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
 * ({@see openstation_register_desktop_theme()}) and put through the
 * same sanitizer. `bin/package-legacy-theme.sh` zips that directory
 * into the distributable a user could hand to someone else.
 *
 * ## It is frozen
 *
 * The manifest is a snapshot and stays one. It was collected from the
 * stylesheets once and is plain data from here on — nothing
 * regenerates it, not this file, not the build, not CI, and there is
 * deliberately no tool that could. When the shell's own defaults move
 * on, Legacy goes on declaring what it declares today, which is the
 * whole reason someone would wear it: they asked for the old look and
 * they keep it. Drifting it with the code would quietly turn the theme
 * into a no-op again. A second snapshot, if one is ever wanted, is a
 * NEW theme under a new id — never a rewrite of this one.
 *
 * Because it is code-registered rather than uploaded, it is always
 * present and cannot be deleted: the delete route only ever touches
 * the uploaded index ({@see openstation_desktop_theme_delete()}). A
 * site that genuinely does not want it calls
 * `openstation_unregister_desktop_theme( 'desktop-mode/legacy' )` on
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
 *   - Context-dependent tokens — `--os-fg`,
 *     `--os-tooltip-bg` and friends read light on the desk
 *     and dark inside a window, so one value breaks one of the two.
 *   - Derived sizes (the badge family) and the texture slots, which
 *     are written by the manifest's `textures` block, not `tokens`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Manifest id of the built-in Legacy theme.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_LEGACY_THEME_ID = 'desktop-mode/legacy';

/**
 * Absolute path of the Legacy theme's `theme.json`.
 *
 * @return string
 */
function openstation_legacy_theme_manifest_path() {
	/**
	 * Filters the path the built-in Legacy theme's manifest is read
	 * from. A site that has forked the token set can point this at
	 * its own `theme.json` without touching the registration.
	 *
	 * @param string $path Absolute path to a `theme.json`.
	 */
	return (string) apply_filters(
		'openstation_legacy_theme_manifest_path',
		OPENSTATION_DIR . 'assets/desktop-themes/legacy/theme.json'
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
function openstation_legacy_theme_tokens() {
	$manifest = openstation_legacy_theme_manifest();
	return isset( $manifest['tokens'] ) && is_array( $manifest['tokens'] )
		? $manifest['tokens']
		: array();
}

/**
 * Read the Legacy theme's manifest off disk.
 *
 * Statically cached: the manifest is data that cannot change inside a
 * request, and the file is read at most once even if something calls
 * the registration twice.
 *
 * @return array Decoded manifest, or an empty array when the file is
 *               missing or unreadable.
 */
function openstation_legacy_theme_manifest() {
	static $manifest = null;
	if ( null !== $manifest ) {
		return $manifest;
	}

	$manifest = array();
	$path     = openstation_legacy_theme_manifest_path();
	if ( ! is_readable( $path ) ) {
		return $manifest;
	}

	$decoded = wp_json_file_decode( $path, array( 'associative' => true ) );
	if ( is_array( $decoded ) ) {
		$manifest = $decoded;
	}
	return $manifest;
}

/**
 * Register the built-in desktop themes.
 *
 * Priority 5 on `init`, the same slot the built-in wallpapers use, so
 * the theme is in the registry before the shell config is built and
 * before any third-party plugin reacting to
 * `openstation_desktop_theme_registered` runs.
 *
 * The name and description are duplicated between here and the
 * manifest on purpose: PHP's copy is translatable, the manifest's is
 * what a user sees if they install the ZIP on a site that does not
 * run OpenStation's own registration. Keep the two in step.
 *
 * @return void
 */
function openstation_register_builtin_desktop_themes() {
	$manifest = openstation_legacy_theme_manifest();
	$tokens   = openstation_legacy_theme_tokens();
	if ( empty( $tokens ) ) {
		return;
	}

	/*
	 * The one thing Legacy recommends: the WordPress blue accent it was
	 * drawn against. The accent is a user setting the station's palette
	 * cannot reach — it is written as an inline style — so without this
	 * the old chrome would come back wearing Pulse focus rings, and the
	 * "Apply recommended layout and effects" button in OS Settings →
	 * Themes would have nothing to offer.
	 */
	$recommended = isset( $manifest['recommendedOsSettings'] ) && is_array( $manifest['recommendedOsSettings'] )
		? $manifest['recommendedOsSettings']
		: array();

	openstation_register_desktop_theme(
		OPENSTATION_LEGACY_THEME_ID,
		array(
			'name'                  => __( 'Desktop Mode (Legacy)', 'desktop-mode' ),
			'version'               => '1.0.0',
			'author'                => 'OpenStation',
			'description'           => __( 'The look Desktop Mode had before the OpenStation brand: every design token at the value it resolved to then. Wear it to put the old palette back, or fork it as the starting point for a theme of your own.', 'desktop-mode' ),
			// A code theme's assets are URLs it already serves. The
			// artwork is the theme previewing itself: desk, dock and
			// one window, painted in the tokens below.
			'preview'               => OPENSTATION_URL . 'assets/desktop-themes/legacy/preview.svg',
			'tokens'                => $tokens,
			'recommendedOsSettings' => $recommended,
		)
	);
}

/*
 * Gated the same way the admin-rendering modules are: nothing on a
 * frontend page view can consult the theme registry, and reading +
 * sanitizing + compiling 377 tokens for a request that will never
 * render the shell is pure waste.
 */
if ( openstation_request_needs_admin_modules() ) {
	add_action( 'init', 'openstation_register_builtin_desktop_themes', 5 );
}
