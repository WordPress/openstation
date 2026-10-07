<?php

defined( 'ABSPATH' ) || exit;

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

	$filtered = (string) apply_filters( 'openstation_my_wordpress_woo_customer_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered );
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

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

		'script'     => 'os-my-wordpress-woocommerce',

		'styles'     => array( 'os-my-wordpress-woocommerce' ),
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

	$args = (array) apply_filters( 'openstation_my_wordpress_woo_customer_window_args', $args );

	$registered = openstation_register_window( 'desktop-mode-woo-customer', $args );
	if ( is_wp_error( $registered ) ) {

		error_log(
			'[openstation] Customer window registration failed: '
			. $registered->get_error_message()
		);
	}
}
add_action( 'init', 'openstation_my_wordpress_woo_customer_window_register', 25 );
