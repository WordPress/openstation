<?php
/**
 * OpenStation — Multisite integration: the shell's multisite block (which
 * instance this shell is, the sites the user may switch to, the network
 * admin menu mirroring the admin bar's Network Admin node — every URL a
 * link OUT, never a window source, see docs/multisite.md), and the
 * per-site table cleanup when a subsite is deleted.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * How many of the network's sites a super admin's switcher lists beyond
 * their own: the network Sites screen's first page. A row, not a
 * directory — a larger network picks its set through the filter below.
 */
const OPENSTATION_MULTISITE_SWITCHER_SITES = 20;

/**
 * The multisite block of the shell config.
 *
 * On a network every site is its own OpenStation, and so is the network
 * admin: the block says which instance this shell is, lists every site
 * the user may switch to (the overview's site switcher), and carries
 * the Network Admin tile's rows. On a single-site install the block
 * comes from the OpenStation network the site belongs to, or is the
 * hub of (`includes/network/`), and is null outside one. `networkAdmin`
 * is null for users who cannot reach the network admin, which is what
 * keeps the tile from registering.
 *
 * @return array|null
 */
function openstation_multisite_payload() {
	if ( ! is_user_logged_in() ) {
		return null;
	}
	if ( ! is_multisite() ) {
		$member = openstation_network_member_payload();
		return null !== $member ? $member : openstation_network_hub_payload();
	}

	$network_admin = null;
	if ( current_user_can( 'manage_network' ) ) {
		$network_admin = array(
			'url'      => esc_url_raw( network_admin_url() ),
			'shellUrl' => esc_url_raw( network_admin_url( 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ) ),
			'rows'     => openstation_multisite_network_admin_rows(),
		);
	}

	return array(
		'isNetworkAdmin' => is_network_admin(),
		'networkAdmin'   => $network_admin,
		'current'        => is_network_admin() ? 'network' : (string) get_current_blog_id(),
		'sites'          => openstation_multisite_sites(),
	);
}

/**
 * The Network Admin tile's rows: the network dashboard and the screens
 * the admin bar's Network Admin node offers, with its capability gates
 * copied one for one so the tile can never offer a screen the admin
 * bar would have hidden.
 *
 * @param bool $all Every row regardless of the current user — for the
 *                  list served to a network's members, whose users the
 *                  hub gates on arrival instead.
 * @return array<int,array{title:string,url:string}>
 */
function openstation_multisite_network_admin_rows( $all = false ) {
	$rows  = array(
		array(
			'title' => __( 'Dashboard', 'desktop-mode' ),
			'url'   => esc_url_raw( network_admin_url() ),
		),
	);
	$gated = array(
		'manage_sites'           => array( 'sites.php', __( 'Sites', 'desktop-mode' ) ),
		'manage_network_users'   => array( 'users.php', __( 'Users', 'desktop-mode' ) ),
		'manage_network_themes'  => array( 'themes.php', __( 'Themes', 'desktop-mode' ) ),
		'manage_network_plugins' => array( 'plugins.php', __( 'Plugins', 'desktop-mode' ) ),
		'manage_network_options' => array( 'settings.php', __( 'Settings', 'desktop-mode' ) ),
	);
	foreach ( $gated as $capability => $row ) {
		if ( $all || current_user_can( $capability ) ) {
			$rows[] = array(
				'title' => $row[1],
				'url'   => esc_url_raw( network_admin_url( $row[0] ) ),
			);
		}
	}
	return $rows;
}

/**
 * The network's sites by path, up to {@see OPENSTATION_MULTISITE_SWITCHER_SITES},
 * minus the archived, spam and deleted.
 *
 * @return array<int,string> Site names keyed by blog id.
 */
function openstation_multisite_network_sites() {
	$names = array();
	$sites = get_sites(
		array(
			'number'   => OPENSTATION_MULTISITE_SWITCHER_SITES,
			'archived' => 0,
			'spam'     => 0,
			'deleted'  => 0,
			'orderby'  => 'path',
			'order'    => 'ASC',
		)
	);
	foreach ( $sites as $site ) {
		$names[ (int) $site->blog_id ] = (string) $site->blogname;
	}
	return $names;
}

/**
 * The sites the user may switch to, each with its own shell screen.
 *
 * The user's own sites first — `get_blogs_of_user()`, the list behind
 * the admin bar's My Sites, minus the archived, spam and deleted, in
 * the order Core keeps them — then, for a super admin, who can reach
 * every site whether or not they are a member, the network's sites by
 * path up to {@see OPENSTATION_MULTISITE_SWITCHER_SITES}; then the
 * members of the OpenStation network this install is the hub of.
 *
 * @return array[] Each `id` (the blog id, or `member:<id>`), `name`, `shellUrl`.
 */
function openstation_multisite_sites() {
	$names = array();
	foreach ( get_blogs_of_user( get_current_user_id() ) as $blog ) {
		$names[ (int) $blog->userblog_id ] = (string) $blog->blogname;
	}
	if ( current_user_can( 'manage_network' ) ) {
		foreach ( openstation_multisite_network_sites() as $blog_id => $name ) {
			if ( ! isset( $names[ $blog_id ] ) ) {
				$names[ $blog_id ] = $name;
			}
		}
	}

	$sites = array();
	foreach ( $names as $blog_id => $name ) {
		$sites[] = array(
			'id'       => (string) $blog_id,
			'name'     => $name,
			'shellUrl' => esc_url_raw( get_admin_url( $blog_id, 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ) ),
		);
	}
	foreach ( openstation_network_member_entries() as $member ) {
		$sites[] = array(
			'id'       => $member['id'],
			'name'     => $member['name'],
			'shellUrl' => $member['shellUrl'],
		);
	}

	/**
	 * Filters the sites the overview's site switcher offers.
	 *
	 * Trim it on a large network, reorder it, rename an entry, or build
	 * a different set. A site dropped here is not offered, though the
	 * admin bar still reaches it.
	 *
	 * @param array[] $sites Each `id` (blog id as a string, or `member:<id>`), `name`, `shellUrl`.
	 */
	return apply_filters( 'openstation_multisite_sites', $sites );
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
