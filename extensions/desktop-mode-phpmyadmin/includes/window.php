<?php
/**
 * phpMyAdmin window registration + bundle delivery.
 *
 * Registers the `osc-phpmyadmin` native window plus a matching desktop
 * icon, applies the env/cap/vendor gates, and installs the Playground
 * config + SQLite driver adapter into the bundled phpMyAdmin
 * distribution.
 *
 * The script handle is served through `admin-ajax.php?action=open_station_phpmyadmin_bundle`
 * — the response body starts with the config assignment, then streams
 * the prebuilt bundle. Everything the bundle needs is in a single HTTP
 * response, so there is no `wp_print_scripts` lifecycle to depend on,
 * no `wp_localize_script` data that can be dropped on the lazy-load
 * path, and no admin-template hook that has to fire on the consuming
 * user's environment.
 *
 * @package OpenStationPhpMyAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * Absolute filesystem path to the bundled phpMyAdmin distribution.
 *
 * @return string
 */
function open_station_phpmyadmin_vendor_dir() {
	return OPEN_STATION_PHPMYADMIN_DIR . 'assets/vendor/phpmyadmin';
}

/**
 * Public URL the iframe loads.
 *
 * Trailing slash kept off so callers can append `/index.php` cleanly.
 *
 * @return string
 */
function open_station_phpmyadmin_vendor_url() {
	return untrailingslashit( OPEN_STATION_PHPMYADMIN_URL . 'assets/vendor/phpmyadmin' );
}

/**
 * Whether the current request runs in a local development environment.
 *
 * @return bool
 */
function open_station_phpmyadmin_environment_allowed() {
	return 'local' === wp_get_environment_type();
}

/**
 * Whether the bundled phpMyAdmin distribution is present on disk.
 *
 * @return bool
 */
function open_station_phpmyadmin_vendor_present() {
	return is_file( open_station_phpmyadmin_vendor_dir() . '/index.php' );
}

/**
 * Whether the current user is allowed to see the phpMyAdmin shortcut.
 *
 * Composite gate — local env, vendor present, `manage_options`.
 *
 * @return bool
 */
function open_station_phpmyadmin_user_can_use() {
	$hard_gates = open_station_phpmyadmin_environment_allowed()
		&& open_station_phpmyadmin_vendor_present();

	$can = $hard_gates && current_user_can( 'manage_options' );

	/**
	 * Filter whether the current user can see/use the phpMyAdmin shortcut.
	 *
	 * Note: the filter may adjust who can use the shortcut, but the
	 * local-env and vendor-present gates are non-negotiable security
	 * gates — they are re-asserted after the filter runs, so a filter
	 * cannot bypass them.
	 *
	 * @param bool $can Default: local env + vendor present + manage_options.
	 */
	return $hard_gates && (bool) apply_filters( 'open_station_phpmyadmin_user_can_use', $can );
}

/**
 * Echoes the phpMyAdmin window's template body.
 *
 * The render callback is JS-side; this skeleton just declares the
 * mount point + a loading state in case the iframe takes a moment to
 * wire up. The `osc-phpmyadmin` class names and `data-osc-phpmyadmin-*`
 * attributes must stay byte-identical to what the prebuilt JS bundle
 * queries — `assets/js/phpmyadmin.js` has no source in this tree, so a
 * selector renamed here and not there silently stops matching.
 */
function open_station_phpmyadmin_render_template() {
	?>
	<div class="osc-phpmyadmin" data-osc-phpmyadmin-root>
		<div class="osc-phpmyadmin__loading" data-osc-phpmyadmin-loading>
			<span class="dashicons dashicons-database" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading phpMyAdmin…', 'desktop-mode-phpmyadmin' ); ?></p>
		</div>
	</div>
	<?php
}

/**
 * Whether this WordPress install uses the sqlite-database-integration
 * plugin (i.e. SQLite, not MySQL/MariaDB).
 *
 * @return bool
 */
function open_station_phpmyadmin_using_sqlite() {
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

/**
 * Copy the plugin's `config.inc.php` template into the vendor dir, and
 * sync the database driver to match the current environment.
 *
 * Driver state is reconciled on every page load so the plugin stays
 * coherent if it's copied between environments. The stock driver is
 * shipped alongside ours at `<file>.stock` inside the vendor dir;
 * this function restores from it when SQLite isn't in use and our
 * adapter is currently installed.
 */
function open_station_phpmyadmin_install_config() {
	$vendor = open_station_phpmyadmin_vendor_dir();

	$config_src = OPEN_STATION_PHPMYADMIN_DIR . 'includes/config.inc.php';
	if ( is_readable( $config_src ) ) {
		// Unconditional — is_writable() returns false for some wasm
		// filesystems where copy() actually succeeds.
		@copy( $config_src, $vendor . '/config.inc.php' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	}

	$driver_path  = $vendor . '/libraries/classes/Dbal/DbiMysqli.php';
	$adapter_src  = OPEN_STATION_PHPMYADMIN_DIR . 'includes/DbiMysqli-sqlite.php';
	$stock_backup = $driver_path . '.stock';

	if ( ! is_dir( dirname( $driver_path ) ) ) {
		return;
	}

	if ( open_station_phpmyadmin_using_sqlite() ) {
		if ( is_readable( $adapter_src ) ) {
			@copy( $adapter_src, $driver_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
	} elseif ( is_file( $driver_path ) && is_file( $stock_backup ) ) {
		// Non-SQLite environment but our adapter may be in place from a
		// previous install. Detect via marker string and restore stock.
		// Both markers are checked: adapters written before the rebrand
		// carry the old one, and they still need restoring.
		$current = (string) @file_get_contents( $driver_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents, WordPress.PHP.NoSilencedErrors.Discouraged
		if ( false !== strpos( $current, 'openstation' ) || false !== strpos( $current, 'OpenStation' ) ) {
			@copy( $stock_backup, $driver_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
	}
}

/**
 * Register the script + style handles backing the phpMyAdmin window.
 *
 * The script URL points at admin-ajax so the bundle response can carry
 * its `window.openStationPhpMyAdminConfig` config inline — see
 * {@see open_station_phpmyadmin_serve_bundle()} for why.
 */
function open_station_phpmyadmin_register_assets() {
	wp_register_style(
		'desktop-mode-phpmyadmin',
		OPEN_STATION_PHPMYADMIN_URL . 'assets/css/phpmyadmin.css',
		array( 'os-variables', 'dashicons' ),
		OPEN_STATION_PHPMYADMIN_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'open_station_phpmyadmin_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-phpmyadmin',
		$bundle_url,
		array( 'wp-i18n', 'openstation' ),
		OPEN_STATION_PHPMYADMIN_VERSION,
		true
	);
}

/**
 * Serve the phpMyAdmin bundle with its config baked in.
 *
 * Hooked on `wp_ajax_open_station_phpmyadmin_bundle`. Outputs:
 *
 *  1. `window.openStationPhpMyAdminConfig = {...};` — vendor URL.
 *  2. The prebuilt phpMyAdmin shim bundle (min when not SCRIPT_DEBUG).
 *
 * The JS-side global name (`openStationPhpMyAdminConfig`) and the native
 * window id (`osc-phpmyadmin`) must stay in lockstep with the prebuilt
 * bundle, which hardcodes both and has no source in this tree.
 */
function open_station_phpmyadmin_serve_bundle() {
	if ( ! open_station_phpmyadmin_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$config = array(
		'vendorUrl' => open_station_phpmyadmin_vendor_url(),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo '/* desktop-mode-phpmyadmin config + bundle */' . "\n";
	echo 'window.openStationPhpMyAdminConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = OPEN_STATION_PHPMYADMIN_DIR . 'assets/js/phpmyadmin' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = OPEN_STATION_PHPMYADMIN_DIR . 'assets/js/phpmyadmin.js';
	}
	if ( file_exists( $bundle ) ) {
		readfile( $bundle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
	}

	exit;
}

/**
 * Register the phpMyAdmin window + desktop icon on `init`.
 *
 * No-op when the composite gate fails. Hooked at priority 20 so the
 * native-window registry has been bootstrapped by openstation core.
 */
function open_station_phpmyadmin_register_window() {
	if ( ! open_station_phpmyadmin_user_can_use() ) {
		return;
	}

	open_station_phpmyadmin_install_config();

	$registered = open_station_register_window(
		'osc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode-phpmyadmin' ),
			'icon'         => 'dashicons-database',
			'template'     => 'open_station_phpmyadmin_render_template',
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
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode-phpmyadmin] window registration failed: ' . $registered->get_error_message() );
		return;
	}

	open_station_register_icon(
		'osc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode-phpmyadmin' ),
			'icon'         => 'dashicons-database',
			'window'       => 'osc-phpmyadmin',
			'position'     => 60,
			'capabilities' => array( 'manage_options' ),
		)
	);
}

/**
 * Enqueue the phpMyAdmin stylesheet for any openstation admin page.
 *
 * The CSS has to be in place before the template is cloned so the
 * loading state renders correctly.
 */
function open_station_phpmyadmin_enqueue_style() {
	if ( ! open_station_phpmyadmin_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-phpmyadmin' );
}

/**
 * Wire the UI surface to OpenStation once we know it's loaded.
 */
function open_station_phpmyadmin_maybe_init_ui() {
	if ( ! function_exists( 'open_station_register_window' ) ) {
		return;
	}

	add_action( 'init', 'open_station_phpmyadmin_register_assets', 20 );
	add_action( 'init', 'open_station_phpmyadmin_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'open_station_phpmyadmin_enqueue_style', 30 );
}

// The bundle endpoint is wired unconditionally so the config is
// reachable even when the consumer's page-render hooks misbehave —
// `open_station_phpmyadmin_user_can_use()` is the actual auth gate
// inside the handler.
add_action( 'wp_ajax_open_station_phpmyadmin_bundle', 'open_station_phpmyadmin_serve_bundle' );
add_action( 'plugins_loaded', 'open_station_phpmyadmin_maybe_init_ui', 20 );
