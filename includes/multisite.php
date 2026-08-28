<?php
/**
 * OpenStation — Multisite shell payload: the network admin menu,
 * mirroring the admin bar's Network Admin node. Its rows are links OUT,
 * never window sources — see docs/multisite.md.
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
	$rows    = array( array( 'title' => __( 'Dashboard', 'desktop-mode' ), 'url' => $network ) );
	$gated   = array(
		'manage_sites'           => array( 'sites.php', __( 'Sites', 'desktop-mode' ) ),
		'manage_network_users'   => array( 'users.php', __( 'Users', 'desktop-mode' ) ),
		'manage_network_themes'  => array( 'themes.php', __( 'Themes', 'desktop-mode' ) ),
		'manage_network_plugins' => array( 'plugins.php', __( 'Plugins', 'desktop-mode' ) ),
		'manage_network_options' => array( 'settings.php', __( 'Settings', 'desktop-mode' ) ),
	);

	foreach ( $gated as $capability => $row ) {
		if ( current_user_can( $capability ) ) {
			$rows[] = array( 'title' => $row[1], 'url' => esc_url_raw( network_admin_url( $row[0] ) ) );
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
