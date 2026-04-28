<?php
/**
 * Desktop Mode — phpMyAdmin window registration.
 *
 * Registers the `wpdc-phpmyadmin` native window + matching desktop icon
 * on `init` (after the desktop window registry is ready). All three
 * gates from `bootstrap.php` apply — local env, `manage_options`,
 * vendor present — and the registration is a no-op when any fail.
 *
 * @package WPDesktopMode
 * @since 0.19.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Absolute filesystem path to the bundled phpMyAdmin distribution.
 *
 * @since 0.19.0
 *
 * @return string
 */
function wpdc_phpmyadmin_vendor_dir() {
	return DESKTOP_MODE_DIR . 'assets/vendor/phpmyadmin';
}

/**
 * Public URL the iframe loads.
 *
 * Trailing slash kept off so callers can append `/index.php` cleanly.
 *
 * @since 0.19.0
 *
 * @return string
 */
function wpdc_phpmyadmin_vendor_url() {
	return untrailingslashit( DESKTOP_MODE_URL . 'assets/vendor/phpmyadmin' );
}

/**
 * Whether the current request runs in a local development environment.
 *
 * Uses the canonical `WP_ENVIRONMENT_TYPE` constant via
 * `wp_get_environment_type()`. Anything other than `local` fails closed.
 *
 * @since 0.19.0
 *
 * @return bool
 */
function wpdc_phpmyadmin_environment_allowed() {
	return 'local' === wp_get_environment_type();
}

/**
 * Whether the bundled phpMyAdmin distribution is present on disk.
 *
 * @since 0.19.0
 *
 * @return bool
 */
function wpdc_phpmyadmin_vendor_present() {
	return is_file( wpdc_phpmyadmin_vendor_dir() . '/index.php' );
}

/**
 * Whether the current user is allowed to see the phpMyAdmin shortcut.
 *
 * Composite gate — local env, vendor present, `manage_options`.
 *
 * @since 0.19.0
 *
 * @return bool
 */
function wpdc_phpmyadmin_available() {
	return wpdc_phpmyadmin_environment_allowed()
		&& wpdc_phpmyadmin_vendor_present()
		&& current_user_can( 'manage_options' );
}

/**
 * Echoes the phpMyAdmin window's template body.
 *
 * The render callback is JS-side ({@see src/phpmyadmin/index.ts}); this
 * skeleton just declares the mount point + a loading state in case the
 * iframe takes a moment to wire up.
 *
 * @since 0.19.0
 */
function wpdc_render_phpmyadmin_template() {
	?>
	<div class="wpdc-phpmyadmin" data-wpdc-phpmyadmin-root>
		<div class="wpdc-phpmyadmin__loading" data-wpdc-phpmyadmin-loading>
			<span class="dashicons dashicons-database" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading phpMyAdmin…', 'desktop-mode' ); ?></p>
		</div>
	</div>
	<?php
}

/**
 * Whether this WordPress install uses the sqlite-database-integration
 * plugin (i.e. SQLite, not MySQL/MariaDB).
 *
 * Detected via class presence (most reliable — only true when the
 * drop-in actually loaded), with filesystem fallbacks for early-init
 * contexts where the plugin hasn't run yet.
 *
 * @since 0.19.0
 *
 * @return bool
 */
function wpdc_phpmyadmin_using_sqlite() {
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
 * sync the database driver to match the current environment (SQLite
 * adapter on Studio-style installs, stock MySQL driver elsewhere).
 *
 * phpMyAdmin's bootstrap loads `config.inc.php` from its install root
 * and instantiates `PhpMyAdmin\Dbal\DbiMysqli` for the actual DB
 * connection. We always ship the config; the driver swap is needed
 * because phpMyAdmin's stock driver speaks raw MySQLi which doesn't
 * exist on Studio (SQLite). The adapter delegates to
 * `WP_SQLite_Driver` instead.
 *
 * Driver state is reconciled on every page load so the plugin stays
 * coherent if it's copied between environments — e.g. moving a
 * workspace from a SQLite install (where our adapter is in place) to
 * a MySQL install would otherwise leave phpMyAdmin trying to load
 * `WP_SQLite_Driver` and dying. The stock driver lives at
 * `<file>.stock` (saved by `bin/fetch-phpmyadmin.sh` right after
 * extraction); this function restores from it when SQLite isn't in
 * use and our adapter is currently installed.
 *
 * @since 0.19.0
 */
function wpdc_phpmyadmin_install_config() {
	$vendor = wpdc_phpmyadmin_vendor_dir();

	$config_src = __DIR__ . '/config.inc.php';
	if ( is_readable( $config_src ) ) {
		// Unconditional — is_writable() returns false for some wasm
		// filesystems where copy() actually succeeds.
		@copy( $config_src, $vendor . '/config.inc.php' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	}

	$driver_path  = $vendor . '/libraries/classes/Dbal/DbiMysqli.php';
	$adapter_src  = __DIR__ . '/DbiMysqli-sqlite.php';
	$stock_backup = $driver_path . '.stock';

	if ( ! is_dir( dirname( $driver_path ) ) ) {
		return;
	}

	if ( wpdc_phpmyadmin_using_sqlite() ) {
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
 * Register the phpMyAdmin window + desktop icon on `init`.
 *
 * No-op when the composite gate fails. Hooked at priority 20 so the
 * native-window registry has been bootstrapped by `components.php`.
 *
 * @since 0.19.0
 */
function wpdc_register_phpmyadmin_window() {
	if ( ! wpdc_phpmyadmin_available() ) {
		return;
	}

	wpdc_phpmyadmin_install_config();

	$registered = desktop_mode_register_window(
		'wpdc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode' ),
			'icon'         => 'dashicons-database',
			'template'     => 'wpdc_render_phpmyadmin_template',
			'script'       => 'wp-desktop-phpmyadmin',
			'width'        => 1100,
			'height'       => 720,
			'min_width'    => 640,
			'min_height'   => 400,
			'placement'    => 'taskbar',
			'capabilities' => array( 'manage_options' ),
		)
	);

	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] phpMyAdmin window registration failed: ' . $registered->get_error_message() );
		return;
	}

	desktop_mode_register_icon(
		'wpdc-phpmyadmin',
		array(
			'title'        => __( 'phpMyAdmin', 'desktop-mode' ),
			'icon'         => 'dashicons-database',
			'window'       => 'wpdc-phpmyadmin',
			'position'     => 60,
			'capabilities' => array( 'manage_options' ),
		)
	);
}
add_action( 'init', 'wpdc_register_phpmyadmin_window', 20 );

/**
 * Hand the vendor URL to the JS bundle.
 *
 * The bundle reads `window.wpDesktopPhpMyAdminConfig.vendorUrl` and
 * mounts `<iframe src="${vendorUrl}/index.php">` into the window body.
 * Skipped when the gate fails so we don't expose the URL to clients
 * that aren't allowed to use the shortcut.
 *
 * @since 0.19.0
 */
function wpdc_localize_phpmyadmin_config() {
	if ( ! wpdc_phpmyadmin_available() ) {
		return;
	}

	wp_localize_script(
		'wp-desktop-phpmyadmin',
		'wpDesktopPhpMyAdminConfig',
		array(
			'vendorUrl' => wpdc_phpmyadmin_vendor_url(),
		)
	);

	// CSS has to be in place before the template is cloned so the
	// loading state renders correctly. Tiny file — cheap to ship to
	// every desktop-mode page load when the user is allowed.
	wp_enqueue_style( 'wp-desktop-phpmyadmin' );
}
add_action( 'admin_enqueue_scripts', 'wpdc_localize_phpmyadmin_config', 30 );
