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
		// A single site has a switcher only as a hub or member of an
		// OpenStation network, and only while that module is on.
		if ( ! openstation_network_on() ) {
			return null;
		}
		$member = openstation_network_member_payload();
		return openstation_multisite_with_hop( null !== $member ? $member : openstation_network_hub_payload() );
	}

	$network_admin = null;
	if ( current_user_can( 'manage_network' ) ) {
		$network_admin = array(
			'url'      => esc_url_raw( network_admin_url() ),
			'shellUrl' => esc_url_raw( network_admin_url( 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ) ),
			'rows'     => openstation_multisite_network_admin_rows(),
			'foreign'  => false,
		);
	}

	return openstation_multisite_with_hop(
		array(
			'isNetworkAdmin' => is_network_admin(),
			'networkAdmin'   => $network_admin,
			'current'        => is_network_admin() ? 'network' : (string) get_current_blog_id(),
			'sites'          => openstation_multisite_sites(),
		)
	);
}

/**
 * The mint route for hop tokens, on any block that has somewhere to
 * hop to. See `includes/network/hop.php`.
 *
 * @param array|null $block The multisite block.
 * @return array|null
 */
function openstation_multisite_with_hop( $block ) {
	if ( is_array( $block ) && openstation_network_on() ) {
		$block['hopUrl'] = esc_url_raw( rest_url( 'desktop-mode/v1/network/hop' ) );
	}
	return $block;
}

/**
 * Whether the OpenStation Network module is on, from anywhere that
 * runs whether or not it loaded. The bootstrap always loads; the
 * module does not.
 *
 * @return bool
 */
function openstation_network_on() {
	return function_exists( 'openstation_network_enabled' ) && openstation_network_enabled();
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
 * Whether OpenStation runs on a site of this network.
 *
 * @param int $blog_id The site.
 * @return bool
 */
function openstation_multisite_active_on( $blog_id ) {
	$plugin = plugin_basename( OPENSTATION_FILE );
	if ( isset( get_site_option( 'active_sitewide_plugins', array() )[ $plugin ] ) ) {
		return true;
	}
	// Running here without being in this site's list means the plugin is
	// loaded some other way (an mu-plugin loader), which reaches every site.
	if ( ! in_array( $plugin, (array) get_option( 'active_plugins', array() ), true ) ) {
		return true;
	}
	return in_array( $plugin, (array) get_blog_option( $blog_id, 'active_plugins', array() ), true );
}

/**
 * My Sites inside a window: its row links follow the shell instead of
 * opening as tabs of the Dashboard window. Visit opens a browser tab;
 * this site's Dashboard goes back to Home; another site's hops to its
 * shell when OpenStation is active there, or opens its wp-admin in a
 * browser tab. The bridge leaves `_blank` and `_top` links to the
 * browser, and a top-level navigation is the same hop the shell takes.
 *
 * @return void
 */
function openstation_multisite_my_sites_load() {
	if ( ! is_multisite() || ! openstation_is_chromeless_request() ) {
		return;
	}
	// Decided up front: Core runs the filter while switched to each
	// site, where `openstation_multisite_active_on()` would read that
	// site's plugin list as this one's.
	$current = get_current_blog_id();
	$active  = array();
	foreach ( get_blogs_of_user( get_current_user_id() ) as $blog ) {
		$active[ (int) $blog->userblog_id ] = openstation_multisite_active_on( (int) $blog->userblog_id );
	}
	add_filter(
		'myblogs_blog_actions',
		static function ( $actions, $user_blog ) use ( $current, $active ) {
			$blog_id = (int) $user_blog->userblog_id;
			return openstation_multisite_my_sites_actions( $actions, $blog_id, $current, ! empty( $active[ $blog_id ] ) );
		},
		10,
		2
	);
}
add_action( 'load-my-sites.php', 'openstation_multisite_my_sites_load' );

/**
 * One My Sites row's links, rewritten for the shell. Runs switched to
 * that site, as Core's `myblogs_blog_actions` does, and leaves markup
 * it does not recognise alone.
 *
 * @param string $actions         The row's links.
 * @param int    $blog_id         The row's site.
 * @param int    $current_blog_id The site whose shell the window is in.
 * @param bool   $active          Whether OpenStation runs on the row's site.
 * @return string
 */
function openstation_multisite_my_sites_actions( $actions, $blog_id, $current_blog_id, $active ) {
	$home  = esc_url( home_url() );
	$admin = esc_url( admin_url() );

	if ( $blog_id === $current_blog_id ) {
		$dashboard = "<a href='" . esc_url( admin_url( 'index.php' ) ) . "'>";
	} elseif ( $active ) {
		$dashboard = "<a href='" . $admin . "' target='_top'>";
	} else {
		$dashboard = "<a href='" . $admin . "' target='_blank' rel='noopener'>";
	}

	return str_replace(
		array( "<a href='" . $home . "'>", "<a href='" . $admin . "'>" ),
		array( "<a href='" . $home . "' target='_blank' rel='noopener'>", $dashboard ),
		(string) $actions
	);
}

/**
 * The network Sites list inside a window: the same rules as My Sites,
 * minus a current site, since the network admin is its own instance.
 * Visit opens a browser tab, and Dashboard hops to the site's shell
 * when OpenStation is active there, or opens its wp-admin in a tab.
 *
 * @return void
 */
function openstation_multisite_sites_list_load() {
	if ( ! is_network_admin() || ! openstation_is_chromeless_request() ) {
		return;
	}
	add_filter(
		'manage_sites_action_links',
		static function ( $actions, $blog_id ) {
			return openstation_multisite_sites_row_actions( (array) $actions, openstation_multisite_active_on( (int) $blog_id ) );
		},
		10,
		2
	);
}
add_action( 'load-sites.php', 'openstation_multisite_sites_list_load' );

/**
 * One network Sites row's actions, with a browsing context on the two
 * links that leave the network admin. A link that already names one
 * is left alone.
 *
 * @param array<string,string> $actions The row's actions, keyed as Core keys them.
 * @param bool                 $active  Whether OpenStation runs on the row's site.
 * @return array<string,string>
 */
function openstation_multisite_sites_row_actions( array $actions, $active ) {
	$targets = array(
		'visit'   => '_blank',
		'backend' => $active ? '_top' : '_blank',
	);
	foreach ( $targets as $key => $target ) {
		if ( isset( $actions[ $key ] ) && is_string( $actions[ $key ] ) && false === strpos( $actions[ $key ], 'target=' ) ) {
			$actions[ $key ] = (string) preg_replace( '/^<a /', '<a target="' . $target . '" ', $actions[ $key ], 1 );
		}
	}
	return $actions;
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
			'adminUrl' => esc_url_raw( get_admin_url( $blog_id ) ),
			'active'   => openstation_multisite_active_on( $blog_id ),
			'kind'     => 'local',
			'foreign'  => false,
		);
	}
	foreach ( openstation_network_on() ? openstation_network_member_entries() : array() as $member ) {
		$sites[] = array(
			'id'       => $member['id'],
			'name'     => $member['name'],
			'shellUrl' => $member['shellUrl'],
			'kind'     => 'member',
			'foreign'  => true,
		);
	}

	/**
	 * Filters the sites the overview's site switcher offers.
	 *
	 * Trim it on a large network, reorder it, rename an entry, or build
	 * a different set. A site dropped here is not offered, though the
	 * admin bar still reaches it.
	 *
	 * @param array[] $sites Each `id` (blog id as a string, or `member:<id>`), `name`, `shellUrl`,
	 *                       `adminUrl` and `active` (whether OpenStation runs there; the switcher
	 *                       opens a site without it at `adminUrl` in a browser tab) on a site of
	 *                       this network, `kind` (`local` for a site of this network, `member` for an install
	 *                       that joined from elsewhere, which the switcher marks as external),
	 *                       `foreign` (whether the entry is another install, which a switch to
	 *                       it needs a login token for).
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
		'openstation_presence',
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
