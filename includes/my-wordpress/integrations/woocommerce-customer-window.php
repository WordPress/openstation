<?php
/**
 * OpenStation — the Customer window.
 *
 * A native window that opens on one customer: who they are, what they
 * are worth, what they bought, and where it ships. Double-clicking a
 * customer tile lands here.
 *
 * It exists because the two things WordPress offers instead are both
 * the wrong screen. The activity footprint answers "what has this
 * person published", which for someone who came to buy a hat is an
 * empty page. `user-edit.php` is a settings form — the place you go to
 * change someone's role, not to understand them.
 *
 * Singleton and retargeting, like the profile window: the id is
 * "the customer window", and *which* customer is an open-time param
 * (`{ customerId }`). Params ride the session, so a reload brings the
 * window back on the same person rather than on a default.
 *
 * Everything here is inert unless WooCommerce is active and the
 * viewer may see customer money.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The window's template body.
 *
 * Deliberately a bare mount point rather than a markup skeleton: the
 * whole surface is data-driven, so a static shell would only be a
 * second place for the layout to live and drift.
 *
 * @return void
 */
function openstation_my_wordpress_woo_customer_window_template() {
	ob_start();
	?>
	<div class="os-woo-customer-window" data-os-woo-customer-root>
		<div class="os-woo-customer-window__loading" data-os-woo-customer-loading>
			<os-spinner></os-spinner>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Customer window's template HTML.
	 *
	 * Keep `data-os-woo-customer-root` intact — the render callback
	 * mounts into it.
	 *
	 * **Status: Experimental**
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_my_wordpress_woo_customer_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the Customer window.
 *
 * `placement => 'none'`: it is never opened from a dock tile, because
 * "the customer window" with no customer means nothing. It is always
 * opened with a `customerId` param from a tile, a menu, or a session
 * restore.
 *
 * @return void
 */
function openstation_my_wordpress_woo_customer_window_register() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return;
	}
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}
	if ( true !== openstation_my_wordpress_woo_customers_permission() ) {
		return;
	}

	$args = array(
		'title'      => __( 'Customer', 'desktop-mode' ),
		'icon'       => 'dashicons-businessperson',
		'template'   => 'openstation_my_wordpress_woo_customer_window_template',
		// Rides the integration bundle that already ships the
		// summary transport and the panel renderers — one more
		// window, no second bundle.
		'script'     => 'os-my-wordpress-woocommerce',
		'style'      => 'os-my-wordpress-woocommerce',
		'width'      => 880,
		'height'     => 700,
		'min_width'  => 520,
		'min_height' => 420,
		'placement'  => 'none',
		'config'     => array(
			'restRoot'  => esc_url_raw( rest_url( 'desktop-mode/v1/woocommerce/' ) ),
			'restNonce' => wp_create_nonce( 'wp_rest' ),
		),
	);

	/**
	 * Filter the Customer window's registration args.
	 *
	 * **Status: Experimental**
	 *
	 * @param array $args `openstation_register_window()` args.
	 */
	$args = (array) apply_filters( 'openstation_my_wordpress_woo_customer_window_args', $args );

	$registered = openstation_register_window( 'desktop-mode-woo-customer', $args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log(
			'[openstation] Customer window registration failed: '
			. $registered->get_error_message()
		);
	}
}
add_action( 'init', 'openstation_my_wordpress_woo_customer_window_register', 25 );
