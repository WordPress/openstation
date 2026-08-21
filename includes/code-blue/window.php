<?php
/**
 * OpenStation — Code Blue: window + desktop icon registration.
 *
 * Filterable surface (mirrors the content-graph module shape):
 *
 *   - `openstation_code_blue_window_args`
 *   - `openstation_code_blue_icon_args`
 *   - `openstation_code_blue_template_html`
 *   - `openstation_code_blue_user_can_use` (in log-reader.php)
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The vitals-monitor SVG, shared by the window icon and the desktop
 * icon.
 *
 * A single pulse waveform: flatline, a beat, flatline. It is the
 * universal mark for "is this thing healthy?", which is exactly the
 * question the window answers — and it stays legible at 20px
 * because it is one stroke. The dot at the end is the live cursor a
 * monitor draws, and doubles as visual weight so the mark doesn't
 * read as a bare zigzag.
 *
 * Drawn in `currentColor` like the Corkboard icon, so `renderIcon()`
 * paints it as a CSS mask and it takes whatever colour the surface
 * is already using for text. Hand-placed at 64×64, the established
 * grid for custom icons here, and held to two elements.
 *
 * @return string Raw `<svg>` markup.
 */
function openstation_code_blue_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<path d="M6 34 H20 L26 16 L36 50 L42 28 L46 34 H52" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
		. '<circle cx="57" cy="34" r="4.5" fill="currentColor"/>'
		. '</svg>';
}

/**
 * Render the Code Blue window's static template body. The bundle
 * mounts its UI into `[data-os-code-blue-root]`.
 */
function openstation_code_blue_render_template() {
	ob_start();
	?>
	<div class="openstation-code-blue" data-os-code-blue-root>
		<div class="os-code-blue__loading" data-os-code-blue-loading>
			<os-spinner></os-spinner>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Code Blue window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_code_blue_template_html', $html );

	$allowed_html = function_exists( 'openstation_native_window_allowed_html' )
		? openstation_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native window + the desktop icon on `init` priority
 * 20, matching the content-graph + my-wordpress modules.
 */
function openstation_code_blue_register_window() {
	if ( ! openstation_code_blue_user_can_use() ) {
		return;
	}

	$icon_uri = 'data:image/svg+xml;base64,' . base64_encode( openstation_code_blue_icon_svg() );

	$window_args = array(
		'title'      => __( 'Code Blue', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'openstation_code_blue_render_template',
		'script'     => 'openstation-code-blue',
		'style'      => 'openstation-code-blue',
		'width'      => 1060,
		'height'     => 700,
		'min_width'  => 720,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			'restNonce' => wp_create_nonce( 'wp_rest' ),
			'apiBase'   => esc_url_raw( rest_url( 'desktop-mode/v1/code-blue' ) ),
		),
	);

	/**
	 * Filter the args used to register the Code Blue native window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_code_blue_window_args', $window_args );

	$registered = openstation_register_window( 'openstation-code-blue', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Code Blue window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Code Blue', 'desktop-mode' ),
		'icon_svg' => openstation_code_blue_icon_svg(),
		'window'   => 'openstation-code-blue',
		'pinned'   => false,
		'position' => 24,
	);

	/**
	 * Filter the args used to register the Code Blue desktop icon.
	 *
	 * @param array $icon_args Args passed to `openstation_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'openstation_code_blue_icon_args', $icon_args );

	openstation_register_icon( 'openstation-code-blue', $icon_args );
}
add_action( 'init', 'openstation_code_blue_register_window', 20 );
