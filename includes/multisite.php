<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_MULTISITE_SWITCHER_SITES = 20;

function openstation_multisite_payload() {
	if ( ! is_user_logged_in() ) {
		return null;
	}
	if ( ! is_multisite() ) {

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

function openstation_multisite_with_hop( $block ) {
	if ( is_array( $block ) && openstation_network_on() ) {
		$block['hopUrl'] = esc_url_raw( rest_url( 'desktop-mode/v1/network/hop' ) );
	}
	return $block;
}

function openstation_network_on() {
	return function_exists( 'openstation_network_enabled' ) && openstation_network_enabled();
}

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

function openstation_multisite_active_on( $blog_id ) {
	$plugin = plugin_basename( OPENSTATION_FILE );
	if ( isset( get_site_option( 'active_sitewide_plugins', array() )[ $plugin ] ) ) {
		return true;
	}

	if ( ! in_array( $plugin, (array) get_option( 'active_plugins', array() ), true ) ) {
		return true;
	}
	return in_array( $plugin, (array) get_blog_option( $blog_id, 'active_plugins', array() ), true );
}

function openstation_multisite_my_sites_load() {
	if ( ! is_multisite() || ! openstation_is_chromeless_request() ) {
		return;
	}

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

	return apply_filters( 'openstation_multisite_sites', $sites );
}

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

function openstation_filter_wpmu_drop_tables( $tables, $site_id ) {
	global $wpdb;

	$prefix = $wpdb->get_blog_prefix( $site_id );
	foreach ( openstation_site_table_names() as $name ) {
		$tables[] = $prefix . $name;
	}

	return $tables;
}
add_filter( 'wpmu_drop_tables', 'openstation_filter_wpmu_drop_tables', 10, 2 );
