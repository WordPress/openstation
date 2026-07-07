<?php
/**
 * phpMyAdmin window registration + bundle delivery.
 *
 * Registers the `wpdc-phpmyadmin` native window plus a matching desktop
 * icon, applies the env/cap/vendor gates, and installs the Playground
 * config + SQLite driver adapter into the bundled phpMyAdmin
 * distribution.
 *
 * The script handle is served through `admin-ajax.php?action=desktop_mode_phpmyadmin_bundle`
 * — the response body starts with the config assignment, then streams
 * the prebuilt bundle. Everything the bundle needs is in a single HTTP
 * response, so there is no `wp_print_scripts` lifecycle to depend on,
 * no `wp_localize_script` data that can be dropped on the lazy-load
 * path, and no admin-template hook that has to fire on the consuming
 * user's environment.
 *
 * @package DesktopModePhpMyAdmin
 * @since   0.6.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Absolute filesystem path to the bundled phpMyAdmin distribution.
 *
 * @since 0.6.0
 *
 * @return string
 */
function desktop_mode_phpmyadmin_vendor_dir() {
	return DESKTOP_MODE_PHPMYADMIN_DIR . 'assets/vendor/phpmyadmin';
}

/**
 * Public URL the iframe loads.
 *
 * Trailing slash kept off so callers can append `/index.php` cleanly.
 *
 * @since 0.6.0
 *
 * @return string
 */
function desktop_mode_phpmyadmin_vendor_url() {
	return untrailingslashit( DESKTOP_MODE_PHPMYADMIN_URL . 'assets/vendor/phpmyadmin' );
}

/**
 * Whether the current request runs in a local development environment.
 *
 * @since 0.6.0
 *
 * @return bool
 */
function desktop_mode_phpmyadmin_environment_allowed() {
	return 'local' === wp_get_environment_type();
}

/**
 * Whether the bundled phpMyAdmin distribution is present on disk.
 *
 * @since 0.6.0
 *
 * @return bool
 */
function desktop_mode_phpmyadmin_vendor_present() {
	return is_file( desktop_mode_phpmyadmin_vendor_dir() . '/index.php' );
}

/**
 * Whether the current user is allowed to see the phpMyAdmin shortcut.
 *
 * Composite gate — local env, vendor present, `manage_options`.
 *
 * @since 0.6.0
 *
 * @return bool
 */
function desktop_mode_phpmyadmin_user_can_use() {
	$hard_gates = desktop_mode_phpmyadmin_environment_allowed()
		&& desktop_mode_phpmyadmin_vendor_present();

	$can = $hard_gates && current_user_can( 'manage_options' );

	/**
	 * Filter whether the current user can see/use the phpMyAdmin shortcut.
	 *
	 * Note: the filter may adjust who can use the shortcut, but the
	 * local-env and vendor-present gates are non-negotiable security
	 * gates — they are re-asserted after the filter runs, so a filter
	 * cannot bypass them.
	 *
	 * @since 0.6.0
	 *
	 * @param bool $can Default: local env + vendor present + manage_options.
	 */
	return $hard_gates && (bool) apply_filters( 'desktop_mode_phpmyadmin_user_can_use', $can );
}

/**
 * Echoes the phpMyAdmin window's template body.
 *
 * The render callback is JS-side; this skeleton just declares the
 * mount point + a loading state in case the iframe takes a moment to
 * wire up. The `wpdc-phpmyadmin` class names and `data-wpdc-phpmyadmin-*`
 * attributes are kept on the legacy `wpdc-` spelling because the
 * prebuilt JS bundle queries them by exactly those selectors.
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_render_template() {
	?>
	<div class="wpdc-phpmyadmin" data-wpdc-phpmyadmin-root>
		<div class="wpdc-phpmyadmin__loading" data-wpdc-phpmyadmin-loading>
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
 * @since 0.6.0
 *
 * @return bool
 */
function desktop_mode_phpmyadmin_using_sqlite() {
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
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_install_config() {
	$vendor = desktop_mode_phpmyadmin_vendor_dir();

	$config_src = DESKTOP_MODE_PHPMYADMIN_DIR . 'includes/config.inc.php';
	if ( is_readable( $config_src ) ) {
		// Unconditional — is_writable() returns false for some wasm
		// filesystems where copy() actually succeeds.
		@copy( $config_src, $vendor . '/config.inc.php' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	}

	$driver_path  = $vendor . '/libraries/classes/Dbal/DbiMysqli.php';
	$adapter_src  = DESKTOP_MODE_PHPMYADMIN_DIR . 'includes/DbiMysqli-sqlite.php';
	$stock_backup = $driver_path . '.stock';

	if ( ! is_dir( dirname( $driver_path ) ) ) {
		return;
	}

	if ( desktop_mode_phpmyadmin_using_sqlite() ) {
		if ( is_readable( $adapter_src ) ) {
			@copy( $adapter_src, $driver_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
	} elseif ( is_file( $driver_path ) && is_file( $stock_backup ) ) {
		// Non-SQLite environment but our adapter may be in place from a
		// previous install. Detect via marker string and restore stock.
		$current = (string) @file_get_contents( $driver_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents, WordPress.PHP.NoSilencedErrors.Discouraged
		if ( false !== strpos( $current, 'wp-desktop-mode' ) ) {
			@copy( $stock_backup, $driver_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
	}
}

/**
 * Register the script + style handles backing the phpMyAdmin window.
 *
 * The script URL points at admin-ajax so the bundle response can carry
 * its `window.wpDesktopPhpMyAdminConfig` config inline — see
 * {@see desktop_mode_phpmyadmin_serve_bundle()} for why.
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_register_assets() {
	wp_register_style(
		'desktop-mode-phpmyadmin',
		DESKTOP_MODE_PHPMYADMIN_URL . 'assets/css/phpmyadmin.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		DESKTOP_MODE_PHPMYADMIN_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'desktop_mode_phpmyadmin_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-phpmyadmin',
		$bundle_url,
		array( 'wp-i18n', 'desktop-mode' ),
		DESKTOP_MODE_PHPMYADMIN_VERSION,
		true
	);
}

/**
 * Serve the phpMyAdmin bundle with its config baked in.
 *
 * Hooked on `wp_ajax_desktop_mode_phpmyadmin_bundle`. Outputs:
 *
 *  1. `window.wpDesktopPhpMyAdminConfig = {...};` — vendor URL.
 *  2. The prebuilt phpMyAdmin shim bundle (min when not SCRIPT_DEBUG).
 *
 * The JS-side global name (`wpDesktopPhpMyAdminConfig`) and the native
 * window id (`wpdc-phpmyadmin`) are kept on the legacy spelling because
 * the prebuilt bundle hardcodes them — renaming would require
 * rebuilding from source.
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_serve_bundle() {
	if ( ! desktop_mode_phpmyadmin_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$config = array(
		'vendorUrl' => desktop_mode_phpmyadmin_vendor_url(),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo '/* desktop-mode-phpmyadmin config + bundle */' . "\n";
	echo 'window.wpDesktopPhpMyAdminConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = DESKTOP_MODE_PHPMYADMIN_DIR . 'assets/js/phpmyadmin' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = DESKTOP_MODE_PHPMYADMIN_DIR . 'assets/js/phpmyadmin.js';
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
 * native-window registry has been bootstrapped by desktop-mode core.
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_register_window() {
	if ( ! desktop_mode_phpmyadmin_user_can_use() ) {
		return;
	}

	desktop_mode_phpmyadmin_install_config();

	$registered = desktop_mode_register_window(
		'wpdc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode-phpmyadmin' ),
			'icon'         => 'dashicons-database',
			'template'     => 'desktop_mode_phpmyadmin_render_template',
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

	desktop_mode_register_icon(
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

/**
 * Enqueue the phpMyAdmin stylesheet for any desktop-mode admin page.
 *
 * The CSS has to be in place before the template is cloned so the
 * loading state renders correctly.
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_enqueue_style() {
	if ( ! desktop_mode_phpmyadmin_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-phpmyadmin' );
}

/**
 * Wire the UI surface to Desktop Mode once we know it's loaded.
 *
 * @since 0.6.0
 */
function desktop_mode_phpmyadmin_maybe_init_ui() {
	if ( ! function_exists( 'desktop_mode_register_window' ) ) {
		return;
	}

	add_action( 'init', 'desktop_mode_phpmyadmin_register_assets', 20 );
	add_action( 'init', 'desktop_mode_phpmyadmin_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'desktop_mode_phpmyadmin_enqueue_style', 30 );
}

// The bundle endpoint is wired unconditionally so the config is
// reachable even when the consumer's page-render hooks misbehave —
// `desktop_mode_phpmyadmin_user_can_use()` is the actual auth gate
// inside the handler.
add_action( 'wp_ajax_desktop_mode_phpmyadmin_bundle', 'desktop_mode_phpmyadmin_serve_bundle' );
add_action( 'plugins_loaded', 'desktop_mode_phpmyadmin_maybe_init_ui', 20 );
