<?php
/**
 * Desktop Mode — Routines: native window registration.
 *
 * Registers the `wpdm-routines` native window, a desktop icon,
 * the JS bundle, and the localised config the bundle reads. The
 * P1 UI is a list view + JSON editor — Phase 2 swaps the body for
 * the visual canvas while keeping the same window id and config
 * shape.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echo the window template body.
 *
 * Static skeleton — the `data-wpdm-routines-*` hooks are the
 * mounting contract the JS bundle relies on. Overrideable via
 * `desktop_mode_routines_template_html`.
 *
 * @since 0.22.0
 */
function wpdm_routines_render_template() {
	ob_start();
	?>
	<div class="wpdm-routines" data-wpdm-routines-root>
		<aside class="wpdm-routines__sidebar" data-wpdm-routines-sidebar>
			<header class="wpdm-routines__sidebar-header">
				<h2 class="wpdm-routines__title"><?php esc_html_e( 'Routines', 'desktop-mode' ); ?></h2>
				<button type="button" class="wpdm-routines__new-btn" data-wpdm-routines-new>
					<span class="dashicons dashicons-plus" aria-hidden="true"></span>
					<?php esc_html_e( 'New', 'desktop-mode' ); ?>
				</button>
			</header>
			<div class="wpdm-routines__list" data-wpdm-routines-list role="list"></div>
			<footer class="wpdm-routines__sidebar-footer">
				<button type="button" class="wpdm-routines__templates-btn" data-wpdm-routines-templates>
					<span class="dashicons dashicons-star-filled" aria-hidden="true"></span>
					<?php esc_html_e( 'Browse templates', 'desktop-mode' ); ?>
				</button>
			</footer>
		</aside>
		<main class="wpdm-routines__main" data-wpdm-routines-main>
			<div class="wpdm-routines__empty" data-wpdm-routines-empty>
				<span class="dashicons dashicons-controls-play" aria-hidden="true"></span>
				<h3><?php esc_html_e( 'Pick a routine on the left, or start from a template.', 'desktop-mode' ); ?></h3>
				<p><?php esc_html_e( 'Routines listen for things that happen on your site (a comment, a new user, a published post) and run a sequence of actions in response. Built-in templates ship in seconds.', 'desktop-mode' ); ?></p>
			</div>
		</main>
	</div>
	<?php
	$html = (string) ob_get_clean();
	/**
	 * Filter the routines window template HTML.
	 *
	 * @since 0.22.0
	 *
	 * @param string $html Default markup.
	 */
	echo apply_filters( 'desktop_mode_routines_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the native window + desktop icon on `init`.
 *
 * @since 0.22.0
 */
function wpdm_routines_register_window() {
	if ( ! wpdm_routine_user_can_manage() ) {
		return;
	}

	$registered = desktop_mode_register_window(
		'wpdm-routines',
		array(
			'title'      => __( 'Routines', 'desktop-mode' ),
			'icon'       => 'dashicons-controls-play',
			'template'   => 'wpdm_routines_render_template',
			'script'     => 'wp-desktop-routines',
			'width'      => 980,
			'height'     => 640,
			'min_width'  => 640,
			'min_height' => 420,
			'placement'  => 'dock',
		)
	);
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Routines window registration failed: ' . $registered->get_error_message() );
		return;
	}

	desktop_mode_register_icon(
		'wpdm-routines',
		array(
			'title'    => __( 'Routines', 'desktop-mode' ),
			'icon'     => 'dashicons-controls-play',
			'window'   => 'wpdm-routines',
			'position' => 70,
		)
	);
}
add_action( 'init', 'wpdm_routines_register_window', 20 );

/**
 * Register the JS bundle + localised config.
 *
 * @since 0.22.0
 */
function wpdm_routines_register_assets() {
	$dev = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG );
	$src = $dev ? 'assets/js/routines.js' : 'assets/js/routines.min.js';

	// `filemtime` (not the plugin-wide version) for the routines
	// JS + CSS — these iterate faster than the plugin version
	// while Phase 2/3 lands and a stale browser cache silently
	// serves the previous build of an absolutely-positioned card
	// layout (or any other in-flight refactor) on top of new
	// markup. Same pattern recycle-bin uses for its CSS.
	$js_path  = DESKTOP_MODE_DIR . $src;
	$css_path = DESKTOP_MODE_DIR . 'assets/css/routines.css';

	wp_register_script(
		'wp-desktop-routines',
		DESKTOP_MODE_URL . $src,
		array( 'wp-desktop' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : DESKTOP_MODE_VERSION,
		true
	);

	wp_register_style(
		'wp-desktop-routines',
		DESKTOP_MODE_URL . 'assets/css/routines.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : DESKTOP_MODE_VERSION
	);
}
add_action( 'init', 'wpdm_routines_register_assets', 15 );

/**
 * Localise REST endpoints + nonce so the bundle never hardcodes URLs.
 *
 * @since 0.22.0
 */
function wpdm_routines_localize_config() {
	if ( ! wpdm_routine_user_can_manage() ) {
		return;
	}

	wp_localize_script(
		'wp-desktop-routines',
		'wpDesktopRoutinesConfig',
		array(
			'restNonce'       => wp_create_nonce( 'wp_rest' ),
			'rootUrl'         => esc_url_raw( rest_url( 'wp-desktop/v1/routines' ) ),
			'catalogUrl'      => esc_url_raw( rest_url( 'wp-desktop/v1/routines/catalog' ) ),
			'templatesUrl'    => esc_url_raw( rest_url( 'wp-desktop/v1/routines/templates' ) ),
			'fromTemplateUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/routines/from-template' ) ),
			// Plugin base URL — handed to the canvas so the Pixi
			// vendor script (`assets/vendor/pixi.min.js`) can be
			// located without the bundle hardcoding a path.
			'pluginUrl'       => esc_url_raw( rtrim( DESKTOP_MODE_URL, '/' ) ),
		)
	);
	wp_enqueue_style( 'wp-desktop-routines' );
}
add_action( 'admin_enqueue_scripts', 'wpdm_routines_localize_config', 30 );
