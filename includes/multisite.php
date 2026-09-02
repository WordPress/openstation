<?php
/**
 * OpenStation — Multisite integration: the network admin menu payload,
 * mirroring the admin bar's Network Admin node (its rows are links OUT,
 * never window sources — see docs/multisite.md), and the per-site table
 * cleanup when a subsite is deleted.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Null on single-site installs and for users who cannot reach the
 * network admin, which is what keeps the tile from registering.
 *
 * @return array|null
 */
function openstation_multisite_payload() {
	if ( ! is_multisite() || ! is_user_logged_in() || ! current_user_can( 'manage_network' ) ) {
		return null;
	}

	// Capability gates copied one for one from
	// `wp_admin_bar_my_sites_menu()`, so the tile can never offer a
	// screen the admin bar would have hidden.
	$network = esc_url_raw( network_admin_url() );
	$rows    = array(
		array(
			'title' => __( 'Dashboard', 'desktop-mode' ),
			'url'   => $network,
		),
	);
	$gated   = array(
		'manage_sites'           => array( 'sites.php', __( 'Sites', 'desktop-mode' ) ),
		'manage_network_users'   => array( 'users.php', __( 'Users', 'desktop-mode' ) ),
		'manage_network_themes'  => array( 'themes.php', __( 'Themes', 'desktop-mode' ) ),
		'manage_network_plugins' => array( 'plugins.php', __( 'Plugins', 'desktop-mode' ) ),
		'manage_network_options' => array( 'settings.php', __( 'Settings', 'desktop-mode' ) ),
	);

	foreach ( $gated as $capability => $row ) {
		if ( current_user_can( $capability ) ) {
			$rows[] = array(
				'title' => $row[1],
				'url'   => esc_url_raw( network_admin_url( $row[0] ) ),
			);
		}
	}

	return array(
		'isNetworkAdmin' => is_network_admin(),
		'networkAdmin'   => array(
			'url'  => $network,
			'rows' => $rows,
		),
	);
}

/**
 * The plugin's per-site tables, unprefixed.
 *
 * A STATIC list, not a read from the schema helpers, on purpose:
 * deleting a site must drop every table the plugin ever created there,
 * and the games module (owner of the last two) only loads while its
 * feature toggle is on — its helper may not exist on the request that
 * deletes the site, but the tables it created earlier still do. The
 * names are frozen identifiers (see AGENTS.md), and
 * `Tests_OpenStation_Multisite` pins this list against the loaded
 * schema helpers so a new table cannot be forgotten here.
 *
 * @return string[] Table names without any prefix.
 */
function openstation_site_table_names() {
	return array(
		'desktop_mode_file_placements',
		'desktop_mode_folders',
		'desktop_mode_file_tombstones',
		'desktop_mode_folder_shares',
		'desktop_mode_share_user_decisions',
		'desktop_mode_stored_files',
		'desktop_mode_game_scores',
		'desktop_mode_game_challenges',
	);
}

/**
 * Adds the plugin's tables to the set Core drops when a site is
 * deleted. Without this, every deleted subsite left its
 * `wp_N_desktop_mode_*` tables behind forever.
 *
 * Core drops with `DROP TABLE IF EXISTS`, so listing a table the site
 * never created (games disabled, or a site deleted before its lazy
 * `init` table creation ran) is fine.
 *
 * @param string[] $tables  Table names Core will drop.
 * @param int      $site_id The site being deleted.
 * @return string[] The list with the plugin's tables appended.
 */
function openstation_filter_wpmu_drop_tables( $tables, $site_id ) {
	global $wpdb;

	// Core switches to the deleted site before applying the filter,
	// but the prefix is anchored on the passed id rather than trusted
	// from the switch — a future caller that forgets to switch would
	// otherwise drop the CURRENT site's tables.
	$prefix = $wpdb->get_blog_prefix( $site_id );
	foreach ( openstation_site_table_names() as $name ) {
		$tables[] = $prefix . $name;
	}

	return $tables;
}
add_filter( 'wpmu_drop_tables', 'openstation_filter_wpmu_drop_tables', 10, 2 );
