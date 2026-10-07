<?php

defined( 'ABSPATH' ) || exit;

function openstation_phpmyadmin_vendor_dir() {
	return OPENSTATION_PHPMYADMIN_DIR . 'assets/vendor/phpmyadmin';
}

function openstation_phpmyadmin_vendor_url() {
	return untrailingslashit( OPENSTATION_PHPMYADMIN_URL . 'assets/vendor/phpmyadmin' );
}

function openstation_phpmyadmin_environment_allowed() {
	return 'local' === wp_get_environment_type();
}

function openstation_phpmyadmin_vendor_present() {
	return is_file( openstation_phpmyadmin_vendor_dir() . '/index.php' );
}

function openstation_phpmyadmin_user_can_use() {
	$hard_gates = openstation_phpmyadmin_environment_allowed()
		&& openstation_phpmyadmin_vendor_present();

	$can = $hard_gates && current_user_can( 'manage_options' );

	return $hard_gates && (bool) apply_filters( 'openstation_phpmyadmin_user_can_use', $can );
}

function openstation_phpmyadmin_render_template() {
	?>
	<div class="wpdc-phpmyadmin" data-osc-phpmyadmin-root>
		<div class="osc-phpmyadmin__loading" data-osc-phpmyadmin-loading>
			<span class="dashicons dashicons-database" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading phpMyAdmin…', 'desktop-mode-phpmyadmin' ); ?></p>
		</div>
	</div>
	<?php
}

function openstation_phpmyadmin_using_sqlite() {
	if ( class_exists( 'WP_SQLite_Driver' ) ) {
		return true;
	}
	if ( ! defined( 'WP_CONTENT_DIR' ) ) {
		return false;
	}
	if ( is_file( WP_CONTENT_DIR . '/db.php' )
		&& ( is_dir( WP_CONTENT_DIR . '/mu-plugins/sqlite-database-integration' )
			|| is_dir( WP_CONTENT_DIR . '/plugins/sqlite-database-integration' ) ) ) {
		return true;
	}
	return false;
}

function openstation_phpmyadmin_install_config() {
	$vendor = openstation_phpmyadmin_vendor_dir();

	$config_src = OPENSTATION_PHPMYADMIN_DIR . 'includes/config.inc.php';
	if ( is_readable( $config_src ) ) {

		@copy( $config_src, $vendor . '/config.inc.php' );
	}

	$driver_path  = $vendor . '/libraries/classes/Dbal/DbiMysqli.php';
	$adapter_src  = OPENSTATION_PHPMYADMIN_DIR . 'includes/DbiMysqli-sqlite.php';
	$stock_backup = $driver_path . '.stock';

	if ( ! is_dir( dirname( $driver_path ) ) ) {
		return;
	}

	if ( openstation_phpmyadmin_using_sqlite() ) {
		if ( is_readable( $adapter_src ) ) {
			@copy( $adapter_src, $driver_path );
		}
	} elseif ( is_file( $driver_path ) && is_file( $stock_backup ) ) {

		$current = (string) @file_get_contents( $driver_path );
		if ( false !== strpos( $current, 'openstation' ) || false !== strpos( $current, 'OpenStation' ) ) {
			@copy( $stock_backup, $driver_path );
		}
	}
}

function openstation_phpmyadmin_register_assets() {
	wp_register_style(
		'desktop-mode-phpmyadmin',
		OPENSTATION_PHPMYADMIN_URL . 'assets/css/phpmyadmin.css',
		array( 'os-variables', 'dashicons' ),
		OPENSTATION_PHPMYADMIN_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'openstation_phpmyadmin_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-phpmyadmin',
		$bundle_url,
		array( 'wp-i18n', 'openstation' ),
		OPENSTATION_PHPMYADMIN_VERSION,
		true
	);
}

function openstation_phpmyadmin_serve_bundle() {
	if ( ! openstation_phpmyadmin_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$config = array(
		'vendorUrl' => openstation_phpmyadmin_vendor_url(),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo 'window.openStationPhpMyAdminConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = OPENSTATION_PHPMYADMIN_DIR . 'assets/js/phpmyadmin' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = OPENSTATION_PHPMYADMIN_DIR . 'assets/js/phpmyadmin.js';
	}
	if ( file_exists( $bundle ) ) {
		readfile( $bundle );
	}

	exit;
}

function openstation_phpmyadmin_register_window() {
	if ( ! openstation_phpmyadmin_user_can_use() ) {
		return;
	}

	openstation_phpmyadmin_install_config();

	$registered = openstation_register_window(
		'wpdc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode-phpmyadmin' ),
			'icon'         => 'dashicons-database',
			'template'     => 'openstation_phpmyadmin_render_template',
			'script'       => 'desktop-mode-phpmyadmin',
			'width'        => 1100,
			'height'       => 720,
			'min_width'    => 640,
			'min_height'   => 400,
			'placement'    => 'dock',
			'capabilities' => array( 'manage_options' ),
		)
	);

	if ( is_wp_error( $registered ) ) {

		error_log( '[desktop-mode-phpmyadmin] window registration failed: ' . $registered->get_error_message() );
		return;
	}

	openstation_register_icon(
		'wpdc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode-phpmyadmin' ),
			'icon'         => 'dashicons-database',
			'window'       => 'wpdc-phpmyadmin',
			'position'     => 60,
			'capabilities' => array( 'manage_options' ),
		)
	);
}

function openstation_phpmyadmin_enqueue_style() {
	if ( ! openstation_phpmyadmin_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-phpmyadmin' );
}

function openstation_phpmyadmin_maybe_init_ui() {
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}

	add_action( 'init', 'openstation_phpmyadmin_register_assets', 20 );
	add_action( 'init', 'openstation_phpmyadmin_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'openstation_phpmyadmin_enqueue_style', 30 );
}

add_action( 'wp_ajax_openstation_phpmyadmin_bundle', 'openstation_phpmyadmin_serve_bundle' );
add_action( 'plugins_loaded', 'openstation_phpmyadmin_maybe_init_ui', 20 );
