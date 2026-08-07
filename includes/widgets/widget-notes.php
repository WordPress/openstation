<?php
/**
 * OpenStation — Note Pad widget PHP registration.
 *
 * The composer surface for pinned notes: a pad of pastel paper on the
 * widget column. The user writes on the top sheet and drags it out of
 * the pad onto the wallpaper, where it becomes a pinned `wpd_note`
 * (see `includes/notes/bootstrap.php` for the data layer).
 *
 * Same registration shape as every widget (template:
 * `includes/widgets/widget-starter.php`): register the script + style
 * handles at `init@5`, announce the widget at `init@6`, eagerly
 * enqueue only the CSS on shell pages.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS bundle and CSS stylesheet handles.
 */
function openstation_register_notes_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-notes' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-notes' . $suffix . '.css';

	wp_register_style(
		'os-notes-widget',
		OPENSTATION_URL . 'assets/js/widget-notes' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-notes-widget',
		OPENSTATION_URL . 'assets/js/widget-notes' . $suffix . '.js',
		array(),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_notes_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on OpenStation shell pages.
 *
 * The JS loads lazily (widget server-sync); the CSS must be present
 * before first mount to avoid a flash of unstyled pad.
 */
function openstation_enqueue_notes_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-notes-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_notes_widget_styles', 20 );

/**
 * Announce the widget to OpenStation.
 */
function openstation_register_notes_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}

	openstation_register_widget(
		'desktop-mode/notes',
		array(
			'label'          => __( 'Note Pad', 'desktop-mode' ),
			'description'    => __( 'Write a note and drag it onto the desktop to pin it.', 'desktop-mode' ),
			'icon'           => 'dashicons-sticky',
			'script'         => 'os-notes-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 300,
			'default_width'  => 300,
			'default_height' => 360,
		)
	);
}
add_action( 'init', 'openstation_register_notes_widget', 6 );
