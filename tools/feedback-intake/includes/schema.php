<?php
/**
 * The one table, created with dbDelta on activation and healed on
 * `admin_init` when the schema version option lags (a file-copy
 * install never runs the activation hook).
 *
 * @package OpenStationFeedbackIntake
 */

defined( 'ABSPATH' ) || exit;

/** Bumped whenever the CREATE TABLE below changes. */
const OSFI_SCHEMA_VERSION = 1;

/** Option holding the installed schema version. */
const OSFI_SCHEMA_OPTION = 'osfi_schema_version';

/**
 * Fully qualified table name.
 *
 * @return string
 */
function osfi_table() {
	global $wpdb;
	return $wpdb->prefix . 'openstation_feedback_deactivations';
}

/**
 * Create or update the table. Idempotent.
 *
 * `reasons` is the dialog's slugs joined with commas, in the dialog's
 * order; the admin screen splits it again. Every count that could
 * fingerprint a site arrives exact and is stored as a bucket.
 */
function osfi_install_schema() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$table           = osfi_table();
	$charset_collate = $wpdb->get_charset_collate();

	// The two spaces before `(id)` are what dbDelta's parser expects.
	dbDelta(
		"CREATE TABLE {$table} (
		id char(36) NOT NULL,
		received_at_ms bigint(20) unsigned NOT NULL,
		reasons varchar(191) NOT NULL DEFAULT '',
		details text NULL,
		plugin_version varchar(32) NOT NULL DEFAULT '',
		wp_version varchar(32) NOT NULL DEFAULT '',
		php_version varchar(32) NOT NULL DEFAULT '',
		locale varchar(32) NOT NULL DEFAULT '',
		multisite tinyint(1) NOT NULL DEFAULT 0,
		ever_enabled tinyint(1) NOT NULL DEFAULT 0,
		deactivator_enabled tinyint(1) NOT NULL DEFAULT 0,
		install_age_days int(11) NULL,
		first_enable_delay_days int(11) NULL,
		enabled_user_bucket varchar(8) NOT NULL DEFAULT '',
		active_plugins_bucket varchar(8) NOT NULL DEFAULT '',
		context varchar(16) NOT NULL DEFAULT '',
		PRIMARY KEY  (id),
		KEY received_at_ms (received_at_ms)
	) {$charset_collate};"
	);

	update_option( OSFI_SCHEMA_OPTION, OSFI_SCHEMA_VERSION, false );
}

/**
 * Heal a missing or stale schema on the next admin page load.
 */
function osfi_maybe_install_schema() {
	if ( (int) get_option( OSFI_SCHEMA_OPTION, 0 ) < OSFI_SCHEMA_VERSION ) {
		osfi_install_schema();
	}
}
add_action( 'admin_init', 'osfi_maybe_install_schema' );
