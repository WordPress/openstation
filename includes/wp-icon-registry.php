<?php
/**
 * OpenStation — registers our icons with WordPress.
 *
 * Core owns the verbs, OpenStation owns the nouns. Save, search, trash and
 * settings come from WordPress; the eleven registered here are the station's
 * own vocabulary, the things that exist because this is a desktop and
 * wp-admin is not.
 *
 * Registering them puts them wherever Core's icons go: the icon picker in the
 * editor, the REST API, and `wp_get_icon( 'openstation/window' )` in PHP, for
 * us and for anyone extending the shell.
 *
 * The API landed in WordPress 7.1 and this plugin supports 6.0, so every call
 * is behind a feature check. On older versions the shell keeps drawing its own
 * inline SVG exactly as it does today; nothing here is load-bearing for the
 * desktop.
 *
 * Not to be confused with {@see openstation_register_icon()} in
 * `includes/registries/icons.php`, which registers a clickable shortcut tile
 * on the desktop wallpaper. That is a surface of the shell. This is artwork
 * handed to WordPress.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the eleven icons OpenStation draws itself, as slug => label.
 *
 * The labels are what a person reads in the icon picker, so they name the
 * concept rather than repeating the slug: `windows` is the overview of all of
 * them, `snap` is the tiling layout, `command` is the palette.
 *
 * @return array<string, string> Icon slug mapped to its translated label.
 */
function openstation_wp_icon_collection() {
	return array(
		'window'  => __( 'Window', 'desktop-mode' ),
		'windows' => __( 'All windows', 'desktop-mode' ),
		'dock'    => __( 'Dock', 'desktop-mode' ),
		'spaces'  => __( 'Spaces', 'desktop-mode' ),
		'copilot' => __( 'Copilot', 'desktop-mode' ),
		'snap'    => __( 'Snap layout', 'desktop-mode' ),
		'command' => __( 'Command palette', 'desktop-mode' ),
		'apps'    => __( 'Apps', 'desktop-mode' ),
		'widgets' => __( 'Widgets', 'desktop-mode' ),
		'user'    => __( 'User', 'desktop-mode' ),
		'lock'    => __( 'Lock', 'desktop-mode' ),
	);
}

/**
 * Registers the `openstation` icon collection and the icons in it.
 *
 * Runs on `init` at the default priority: Core registers its own collection on
 * the same hook at priority 0, so the registry is ready by the time this runs.
 *
 * @return void
 */
function openstation_register_wp_icons() {
	if ( ! function_exists( 'wp_register_icon_collection' ) || ! function_exists( 'wp_register_icon' ) ) {
		return;
	}

	/*
	 * Ask before registering, rather than reading the return value.
	 *
	 * `wp_register_icon_collection()` does return false for a slug that is
	 * already there, but it calls `_doing_it_wrong()` on the way out, so by
	 * the time we see the false a notice has already been raised. Anything
	 * that runs `init` twice in one request then trips it, and in a test run
	 * WordPress turns that notice into a failure.
	 *
	 * `is_registered()` on the registry is the only way to ask without
	 * triggering it: 7.1 ships no `wp_is_icon_collection_registered()`
	 * wrapper. Guarded by `class_exists` so this stays safe if that changes.
	 */
	if ( class_exists( 'WP_Icon_Collections_Registry' ) ) {
		$collections = WP_Icon_Collections_Registry::get_instance();
		if ( $collections->is_registered( 'openstation' ) ) {
			return;
		}
	}

	if ( ! wp_register_icon_collection(
		'openstation',
		array(
			'label'       => __( 'OpenStation', 'desktop-mode' ),
			'description' => __( 'Icons for the desktop shell: windows, spaces, the dock, and the command palette.', 'desktop-mode' ),
		)
	) ) {
		return;
	}

	foreach ( openstation_wp_icon_collection() as $slug => $label ) {
		wp_register_icon(
			'openstation/' . $slug,
			array(
				'label'     => $label,
				'file_path' => OPENSTATION_DIR . 'assets/icons/' . $slug . '.svg',
			)
		);
	}
}
add_action( 'init', 'openstation_register_wp_icons' );
