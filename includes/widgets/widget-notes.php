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
function open_station_register_notes_widget_assets() {
	$suffix  = open_station_asset_suffix();
	$version = defined( 'OPEN_STATION_VERSION' ) ? OPEN_STATION_VERSION : '0';

	$js_path  = OPEN_STATION_DIR . 'assets/js/widget-notes' . $suffix . '.js';
	$css_path = OPEN_STATION_DIR . 'assets/js/widget-notes' . $suffix . '.css';

	wp_register_style(
		'os-notes-widget',
		OPEN_STATION_URL . 'assets/js/widget-notes' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-notes-widget',
		OPEN_STATION_URL . 'assets/js/widget-notes' . $suffix . '.js',
		array(),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'open_station_register_notes_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on OpenStation shell pages.
 *
 * The JS loads lazily (widget server-sync); the CSS must be present
 * before first mount to avoid a flash of unstyled pad.
 */
function open_station_enqueue_notes_widget_styles() {
	if ( function_exists( 'open_station_is_enabled' ) && ! open_station_is_enabled() ) {
		return;
	}
	if ( function_exists( 'open_station_is_chromeless_request' ) && open_station_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-notes-widget' );
}
add_action( 'admin_enqueue_scripts', 'open_station_enqueue_notes_widget_styles', 20 );

/**
 * Announce the widget to OpenStation.
 */
function open_station_register_notes_widget() {
	if ( ! function_exists( 'open_station_register_widget' ) ) {
		return;
	}

	open_station_register_widget(
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
add_action( 'init', 'open_station_register_notes_widget', 6 );
