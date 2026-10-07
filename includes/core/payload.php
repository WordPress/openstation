<?php

defined( 'ABSPATH' ) || exit;

function openstation_build_dock_items() {
	global $menu, $submenu;

	if ( empty( $menu ) ) {
		return array();
	}

	$items = array();

	foreach ( $menu as $item ) {

		if ( ! empty( $item[4] ) && false !== strpos( $item[4], 'wp-menu-separator' ) ) {
			continue;
		}

		if ( empty( $item[2] ) ) {
			continue;
		}

		if ( ! empty( $item[1] ) && ! current_user_can( $item[1] ) ) {
			continue;
		}

		if ( openstation_menu_item_is_hidden( $item ) ) {
			continue;
		}

		$title = openstation_menu_item_title( $item[0] );

		$badge = 0;
		if ( preg_match( '/class="(?:update-plugins|awaiting-mod)[^"]*count-(\d+)"/', $item[0], $matches ) ) {
			$badge = (int) $matches[1];
		}

		if (
			'plugins.php' === $item[2] &&
			! is_multisite() &&
			function_exists( 'openstation_plugins_window_count_visible_updates' )
		) {
			$badge = openstation_plugins_window_count_visible_updates();
		}

		$raw_icon = (string) ( $item[6] ?? '' );
		if ( '' === $raw_icon || 'none' === $raw_icon || 'div' === $raw_icon ) {
			$snapshot = openstation_menu_icon_snapshot();
			if ( isset( $snapshot[ $item[2] ] ) ) {
				$raw_icon = $snapshot[ $item[2] ];
			}
		}
		$icon = openstation_sanitize_dock_icon( $raw_icon );

		$parent_url      = openstation_menu_item_url( $item[2] );
		$parent_external = openstation_menu_item_is_external( $parent_url );

		$plugin_file         = openstation_resolve_menu_plugin_file( $item[2] );
		$allow_external_subs = null !== $plugin_file && ! $parent_external;

		$rows             = array();
		$restore_slots    = array();
		$dropped_off_site = 0;
		if ( ! empty( $submenu[ $item[2] ] ) ) {
			foreach ( $submenu[ $item[2] ] as $sub_item ) {
				if ( ! empty( $sub_item[1] ) && ! current_user_can( $sub_item[1] ) ) {
					continue;
				}

				$sub_url      = openstation_menu_item_url( $sub_item[2] );
				$sub_external = openstation_menu_item_is_external( $sub_url );

				if ( $sub_external && ! $allow_external_subs ) {
					++$dropped_off_site;

					$dropped_title = openstation_menu_item_title( $sub_item[0] );
					if ( '' !== $dropped_title && ! isset( $restore_slots[ $dropped_title ] ) ) {
						$rows[]                          = array( 'restore' => $dropped_title );
						$restore_slots[ $dropped_title ] = count( $rows ) - 1;
					}
					continue;
				}

				$rows[] = array(
					'raw_title' => $sub_item[0],
					'slug'      => (string) $sub_item[2],
					'url'       => $sub_url,
					'external'  => $sub_external,
					'hidden'    => openstation_menu_item_is_hidden( $sub_item ),
				);
			}
		}

		$restored = array();
		$keep     = array_fill( 0, count( $rows ), true );
		foreach ( $rows as $i => $row ) {
			if ( isset( $row['restore'] ) || ! $row['hidden'] ) {
				continue;
			}
			$keep[ $i ] = false;
			$row_title  = openstation_menu_item_title( $row['raw_title'] );
			if ( '' === $row_title || isset( $restored[ $row_title ] ) ) {
				continue;
			}
			if ( isset( $restore_slots[ $row_title ] ) ) {
				$rows[ $restore_slots[ $row_title ] ] = $row;
				$restored[ $row_title ]               = true;
			} elseif ( $parent_external && $row_title === $title ) {

				$keep[ $i ]             = true;
				$restored[ $row_title ] = true;
			}
		}

		if ( $parent_external ) {
			$has_on_site = false;
			foreach ( $rows as $i => $row ) {
				if ( ! isset( $row['restore'] ) && $keep[ $i ] && ! $row['external'] ) {
					$has_on_site = true;
					break;
				}
			}
			if ( ! $has_on_site ) {
				foreach ( $rows as $i => $row ) {
					if ( isset( $row['restore'] ) || ! $row['hidden'] || $row['external'] ) {
						continue;
					}
					$keep[ $i ] = true;
					break;
				}
			}
		}

		$kept_rows = array();
		foreach ( $rows as $i => $row ) {
			if ( isset( $row['restore'] ) || ! $keep[ $i ] ) {
				continue;
			}
			$kept_rows[] = $row;
		}
		$rows = $kept_rows;

		$identity_slug = (string) $item[2];
		if ( $parent_external ) {
			foreach ( $rows as $row ) {
				if ( ! $row['external'] ) {
					$parent_url    = $row['url'];
					$identity_slug = $row['slug'];
					break;
				}
			}
		}

		$parent_is_container = $dropped_off_site > 0
			&& ! $parent_external
			&& ! openstation_menu_slug_has_page( $item[2] );

		$url                   = $parent_url;
		$sub_items             = array();
		$first_visible_sub_url = null;
		$has_self_link         = false;
		$self_label            = '';
		foreach ( $rows as $row ) {
			$sub_url = $row['url'];
			if ( $parent_is_container && $sub_url === $parent_url ) {

				continue;
			}

			if ( null === $first_visible_sub_url && ! $row['external'] ) {
				$first_visible_sub_url = $sub_url;
			}

			if ( $sub_url === $parent_url ) {
				$has_self_link = true;

				if ( '' === $self_label ) {
					$self_label = openstation_menu_item_title( $row['raw_title'] );
				}
				continue;
			}

			$sub_title = openstation_menu_item_title( $row['raw_title'] );
			if ( '' === $sub_title ) {
				continue;
			}
			$sub_entry = array(
				'title' => $sub_title,
				'url'   => $sub_url,

				'slug'  => (string) $row['slug'],
			);
			if ( $row['external'] ) {

				$sub_entry['offSite'] = true;
			}
			$sub_items[] = $sub_entry;
		}

		if ( null !== $first_visible_sub_url && ! $has_self_link ) {
			$url = $first_visible_sub_url;
		}

		if ( openstation_menu_item_is_external( $url ) ) {
			continue;
		}

		if ( $parent_is_container && $url === $parent_url ) {
			continue;
		}

		$window_tabs = openstation_app_menu_tabs( $identity_slug );
		if ( $window_tabs ) {
			$self_label = $window_tabs[0]['label'];
			$claimed    = array();
			foreach ( $window_tabs as $tab ) {
				if ( '' !== $tab['page'] ) {
					$claimed[] = $tab['page'];
				}
			}

			$kept = array();
			foreach ( $sub_items as $sub_entry ) {
				if ( ! in_array( $sub_entry['slug'], $claimed, true ) ) {
					$kept[] = $sub_entry;
				}
			}
			$sub_items = array();
			foreach ( array_slice( $window_tabs, 1 ) as $tab ) {
				$sub_items[] = array(
					'title' => $tab['label'],
					'url'   => add_query_arg( 'os_tab', $tab['id'], $url ),
				);
			}
			$sub_items = array_merge( $sub_items, $kept );
		}
		foreach ( $sub_items as $i => $sub_entry ) {
			unset( $sub_items[ $i ]['slug'] );
		}

		$dock_item = array(
			'id'         => sanitize_key( $item[5] ?? $item[2] ),
			'title'      => $title,
			'icon'       => $icon,
			'url'        => $url,
			'badge'      => $badge,
			'submenu'    => $sub_items,

			'selfLabel'  => $self_label,
			'multi'      => openstation_dock_item_is_multi( $identity_slug ),
			'placement'  => openstation_dock_placement( $identity_slug ),
			'isCore'     => openstation_is_core_menu_slug( $identity_slug ),
			'pluginFile' => $identity_slug === (string) $item[2]
				? $plugin_file
				: openstation_resolve_menu_plugin_file( $identity_slug ),
			'pluginName' => null,
		);
		if ( $dock_item['pluginFile'] ) {
			$dock_item['pluginName'] = openstation_plugin_display_name( $dock_item['pluginFile'] );
		}

		$dock_item = apply_filters( 'openstation_dock_item', $dock_item, $identity_slug );

		$items[] = $dock_item;
	}

	return apply_filters( 'openstation_dock_items', $items );
}

function openstation_menu_item_is_external( $url ) {
	$host     = wp_parse_url( (string) $url, PHP_URL_HOST );
	$external = false;

	if ( $host ) {
		$ours = array();
		foreach ( array( openstation_menu_admin_url(), admin_url(), home_url() ) as $known ) {
			$known_host = wp_parse_url( $known, PHP_URL_HOST );
			if ( $known_host ) {
				$ours[] = strtolower( $known_host );
			}
		}
		$external = ! in_array( strtolower( $host ), $ours, true );
	}

	return (bool) apply_filters( 'openstation_menu_item_is_external', $external, $url );
}

function openstation_menu_item_is_hidden( $item ) {
	return ! empty( $item[4] ) && false !== strpos( (string) $item[4], 'hide-if-js' );
}

function openstation_menu_slug_has_page( $slug ) {
	if ( openstation_is_admin_file_slug( $slug ) ) {
		return true;
	}

	if ( ! function_exists( 'get_plugin_page_hookname' ) ) {
		return true;
	}

	$hookname = get_plugin_page_hookname( $slug, '' );
	if ( empty( $hookname ) ) {
		return true;
	}

	return has_action( $hookname );
}

function &openstation_menu_icon_snapshot() {
	static $map = null;
	if ( null === $map ) {
		$map = array();
	}
	return $map;
}

function openstation_snapshot_menu_icons() {
	global $menu;

	if ( ! is_array( $menu ) ) {
		return;
	}

	$map = &openstation_menu_icon_snapshot();

	foreach ( $menu as $item ) {
		if ( empty( $item[2] ) || empty( $item[6] ) ) {
			continue;
		}
		$slug = (string) $item[2];
		if ( isset( $map[ $slug ] ) ) {
			continue;
		}
		$icon = (string) $item[6];
		if ( 'none' === $icon || 'div' === $icon ) {
			continue;
		}
		$map[ $slug ] = $icon;
	}
}

foreach ( array( 11, 100, 1000, 99998, PHP_INT_MAX ) as $openstation_icon_snapshot_priority ) {
	add_action( 'admin_menu', 'openstation_snapshot_menu_icons', $openstation_icon_snapshot_priority );
}
unset( $openstation_icon_snapshot_priority );

function openstation_sanitize_dock_icon( $icon ) {
	$fallback = 'dashicons-admin-generic';
	if ( ! is_string( $icon ) || '' === $icon ) {
		return $fallback;
	}

	$icon = trim( $icon );

	if ( 'none' === $icon || 'div' === $icon ) {
		return $fallback;
	}

	if ( 0 === strpos( $icon, 'dashicons-' ) ) {

		return preg_replace( '/[^a-z0-9_-]/', '', $icon );
	}

	if ( 0 === stripos( $icon, 'http://' ) || 0 === stripos( $icon, 'https://' ) ) {
		$clean = esc_url_raw( $icon, array( 'http', 'https' ) );
		return $clean ? $clean : $fallback;
	}

	if ( 0 === stripos( $icon, 'data:image/svg+xml' ) ) {
		if (
			preg_match( '#^data:image/svg\+xml;base64,[A-Za-z0-9+/=]+$#i', $icon )
			|| preg_match( '#^data:image/svg\+xml,[A-Za-z0-9._~!$&\'()*+,;=:@/?%-]+$#i', $icon )
		) {
			return $icon;
		}

	}

	return $fallback;
}

function openstation_dock_item_is_multi( $menu_slug ) {

	$multi_files = array(
		'edit.php',
		'edit-tags.php',
		'upload.php',
		'users.php',
		'edit-comments.php',
	);

	$base  = strtok( (string) $menu_slug, '?' );
	$multi = in_array( $base, $multi_files, true );

	return (bool) apply_filters( 'openstation_dock_item_multi', $multi, $menu_slug );
}

function openstation_is_core_menu_slug( $menu_slug ) {
	$slug = (string) $menu_slug;
	$base = strtok( $slug, '?' );

	$core_files = array(
		'index.php',
		'edit.php',
		'edit-comments.php',
		'upload.php',
		'edit-tags.php',
		'term.php',
		'post-new.php',
		'post.php',
		'themes.php',
		'nav-menus.php',
		'widgets.php',
		'customize.php',
		'plugins.php',
		'plugin-install.php',
		'plugin-editor.php',
		'users.php',
		'user-new.php',
		'profile.php',
		'user-edit.php',
		'tools.php',
		'import.php',
		'export.php',
		'site-health.php',
		'export-personal-data.php',
		'erase-personal-data.php',
		'options-general.php',
		'options-writing.php',
		'options-reading.php',
		'options-discussion.php',
		'options-media.php',
		'options-permalink.php',
		'options-privacy.php',
		'link-manager.php',
		'update-core.php',
	);

	if ( is_network_admin() ) {
		$core_files[] = 'sites.php';
		$core_files[] = 'settings.php';
	}

	return in_array( $base, $core_files, true );
}

function openstation_resolve_menu_plugin_file( $menu_slug ) {
	$slug = (string) $menu_slug;

	if ( ! function_exists( 'get_plugin_page_hookname' ) || ! function_exists( 'get_plugins' ) ) {
		return null;
	}

	$self_basename = defined( 'OPENSTATION_FILE' ) ? plugin_basename( OPENSTATION_FILE ) : '';

	$map = openstation_menu_attribution_map();
	if ( isset( $map[ $slug ] ) ) {
		$plugin_file = $map[ $slug ];
		if ( $self_basename && $plugin_file === $self_basename ) {
			return null;
		}
		return $plugin_file;
	}

	$tracked = openstation_lookup_taxonomy_or_post_type_plugin_file( $slug );
	if ( null !== $tracked ) {
		if ( $self_basename && $tracked === $self_basename ) {
			return null;
		}
		return $tracked;
	}

	$base = strtok( $slug, '?' );

	if ( openstation_is_pure_core_file( $base ) && false === strpos( $slug, '?page=' ) ) {
		return null;
	}

	global $wp_filter;
	$hookname = get_plugin_page_hookname( $slug, '' );
	if ( empty( $hookname ) || empty( $wp_filter[ $hookname ] ) ) {
		return null;
	}

	$hook = $wp_filter[ $hookname ];
	foreach ( $hook->callbacks as $cbs ) {
		foreach ( $cbs as $cb ) {
			$plugin_file = openstation_plugin_file_for_callback( $cb['function'] ?? null );
			if ( ! $plugin_file ) {
				continue;
			}
			if ( $self_basename && $plugin_file === $self_basename ) {
				return null;
			}
			return $plugin_file;
		}
	}

	return null;
}

function openstation_plugin_display_name( $plugin_file ) {
	if ( ! function_exists( 'get_plugins' ) ) {
		$dir = strtok( $plugin_file, '/' );
		return $dir ? $dir : $plugin_file;
	}
	$installed = get_plugins();
	if ( isset( $installed[ $plugin_file ]['Name'] ) && '' !== $installed[ $plugin_file ]['Name'] ) {
		return (string) $installed[ $plugin_file ]['Name'];
	}
	$folder = strtok( $plugin_file, '/' );
	return $folder ? $folder : $plugin_file;
}

function openstation_plugin_file_for_path( $file ) {
	if ( ! is_string( $file ) || '' === $file ) {
		return null;
	}
	$plugins_dir = wp_normalize_path( WP_PLUGIN_DIR );
	$norm        = openstation_plugin_link_path( wp_normalize_path( $file ) );
	if ( 0 !== strpos( $norm, $plugins_dir . '/' ) ) {
		return null;
	}
	if ( ! function_exists( 'get_plugins' ) ) {
		return null;
	}
	$installed = get_plugins();

	$rel    = ltrim( substr( $norm, strlen( $plugins_dir ) ), '/' );
	$folder = ( false !== strpos( $rel, '/' ) ) ? strtok( $rel, '/' ) : '';

	foreach ( $installed as $plugin_file => $_data ) {
		if ( '' !== $folder && 0 === strpos( $plugin_file, $folder . '/' ) ) {
			return $plugin_file;
		}
		if ( '' === $folder && $plugin_file === $rel ) {
			return $plugin_file;
		}
	}
	return null;
}

function openstation_plugin_file_for_callback( $callback ) {
	$file = openstation_callback_source_file( $callback );
	return $file ? openstation_plugin_file_for_path( $file ) : null;
}

function &openstation_menu_attribution_map() {
	static $map = null;
	if ( null === $map ) {
		$map = array();
	}
	return $map;
}

function openstation_install_menu_attribution_tracker() {
	static $installed = false;
	if ( $installed ) {
		return;
	}
	$installed = true;

	global $wp_filter;
	if ( empty( $wp_filter['admin_menu'] ) ) {
		return;
	}
	$hook = $wp_filter['admin_menu'];

	foreach ( $hook->callbacks as $priority => $cbs ) {
		foreach ( $cbs as $id => $cb ) {
			$orig        = $cb['function'] ?? null;
			$plugin_file = openstation_plugin_file_for_callback( $orig );
			if ( ! $plugin_file || ! is_callable( $orig ) ) {
				continue;
			}
			$accepted_args = (int) ( $cb['accepted_args'] ?? 1 );

			$wrapper = static function () use ( $orig, $plugin_file ) {
				global $menu, $submenu;

				$before_top_slugs = array();
				if ( is_array( $menu ) ) {
					foreach ( $menu as $entry ) {
						if ( isset( $entry[2] ) ) {
							$before_top_slugs[ (string) $entry[2] ] = true;
						}
					}
				}
				$before_submenu_keys = is_array( $submenu ) ? array_keys( $submenu ) : array();
				$before_submenu_sigs = array();
				if ( is_array( $submenu ) ) {
					foreach ( $submenu as $parent => $children ) {
						$sigs = array();
						foreach ( (array) $children as $child ) {
							if ( isset( $child[2] ) ) {
								$sigs[ (string) $child[2] ] = true;
							}
						}
						$before_submenu_sigs[ $parent ] = $sigs;
					}
				}

				$args   = func_get_args();
				$return = call_user_func_array( $orig, $args );

				$map = &openstation_menu_attribution_map();

				if ( is_array( $menu ) ) {
					foreach ( $menu as $entry ) {
						if ( ! isset( $entry[2] ) ) {
							continue;
						}
						$slug = (string) $entry[2];
						if ( ! isset( $before_top_slugs[ $slug ] ) && ! isset( $map[ $slug ] ) ) {
							$map[ $slug ] = $plugin_file;
						}
					}
				}

				if ( is_array( $submenu ) ) {
					foreach ( $submenu as $parent => $children ) {
						$prev_sigs = $before_submenu_sigs[ $parent ] ?? array();
						foreach ( (array) $children as $child ) {
							if ( ! isset( $child[2] ) ) {
								continue;
							}
							$slug = (string) $child[2];
							if ( isset( $prev_sigs[ $slug ] ) ) {
								continue;
							}
							if ( ! isset( $map[ $slug ] ) ) {
								$map[ $slug ] = $plugin_file;
							}

						}
						if (
							! in_array( $parent, $before_submenu_keys, true )
							&& ! isset( $map[ $parent ] )
						) {
							$map[ $parent ] = $plugin_file;
						}
					}
				}

				return $return;
			};

			$wp_filter['admin_menu']->callbacks[ $priority ][ $id ] = array(
				'function'      => $wrapper,
				'accepted_args' => $accepted_args,
			);
		}
	}
}

add_action( '_admin_menu', 'openstation_install_menu_attribution_tracker', -PHP_INT_MAX );
add_action( '_network_admin_menu', 'openstation_install_menu_attribution_tracker', -PHP_INT_MAX );
add_action( '_user_admin_menu', 'openstation_install_menu_attribution_tracker', -PHP_INT_MAX );

function openstation_is_pure_core_file( $base ) {
	$core_files = array(
		'index.php',
		'edit-comments.php',
		'upload.php',
		'term.php',
		'post-new.php',
		'post.php',
		'themes.php',
		'nav-menus.php',
		'widgets.php',
		'customize.php',
		'plugins.php',
		'plugin-install.php',
		'plugin-editor.php',
		'users.php',
		'user-new.php',
		'profile.php',
		'user-edit.php',
		'tools.php',
		'import.php',
		'export.php',
		'site-health.php',
		'export-personal-data.php',
		'erase-personal-data.php',
		'options-general.php',
		'options-writing.php',
		'options-reading.php',
		'options-discussion.php',
		'options-media.php',
		'options-permalink.php',
		'options-privacy.php',
		'link-manager.php',
		'update-core.php',
	);
	return in_array( $base, $core_files, true );
}

function openstation_lookup_taxonomy_or_post_type_plugin_file( $slug ) {
	if ( false !== strpos( $slug, 'edit.php?' ) && false !== strpos( $slug, 'post_type=' ) ) {
		$qs = wp_parse_url( 'http://x/' . ltrim( $slug, '/' ), PHP_URL_QUERY );
		parse_str( (string) $qs, $args );
		$pt = isset( $args['post_type'] ) ? (string) $args['post_type'] : '';
		if ( '' === $pt ) {
			return null;
		}
		$file = openstation_type_registrant_file( $pt, 'post_type' );
		return null === $file ? null : openstation_plugin_file_for_path( $file );
	}
	if ( false !== strpos( $slug, 'edit-tags.php?' ) && false !== strpos( $slug, 'taxonomy=' ) ) {
		$qs = wp_parse_url( 'http://x/' . ltrim( $slug, '/' ), PHP_URL_QUERY );
		parse_str( (string) $qs, $args );
		$tx = isset( $args['taxonomy'] ) ? (string) $args['taxonomy'] : '';
		if ( '' === $tx ) {
			return null;
		}
		$file = openstation_type_registrant_file( $tx, 'taxonomy' );
		return null === $file ? null : openstation_plugin_file_for_path( $file );
	}
	return null;
}

function &openstation_get_typed_registrant_map() {
	static $map = null;
	if ( null === $map ) {
		$map = array(
			'post_type' => array(),
			'taxonomy'  => array(),
		);
	}
	return $map;
}

function openstation_type_registrant_file( $type, $kind ) {
	$map = openstation_get_typed_registrant_map();
	return $map[ $kind ][ $type ] ?? null;
}

function openstation_should_track_type_registrants() {
	$track = is_admin();

	return (bool) apply_filters( 'openstation_track_type_registrants', $track );
}

function openstation_record_type_registrant( $type_or_post_type, $kind ) {
	if ( '' === (string) $type_or_post_type ) {
		return;
	}
	if ( ! openstation_should_track_type_registrants() ) {
		return;
	}

	if ( 'post_type' === $kind ) {
		$obj = get_post_type_object( $type_or_post_type );
		if ( $obj && ! empty( $obj->_builtin ) ) {
			return;
		}
	} elseif ( 'taxonomy' === $kind ) {
		$obj = get_taxonomy( $type_or_post_type );
		if ( $obj && ! empty( $obj->_builtin ) ) {
			return;
		}
	}

	$file = openstation_registrant_file_from_backtrace();
	if ( null === $file ) {
		return;
	}
	$map                                = &openstation_get_typed_registrant_map();
	$map[ $kind ][ $type_or_post_type ] = $file;
}

function openstation_extension_dirs() {
	static $dirs = null;
	if ( null !== $dirs ) {
		return $dirs;
	}
	$dirs = array();
	if ( defined( 'WP_PLUGIN_DIR' ) ) {
		$dirs[] = wp_normalize_path( WP_PLUGIN_DIR ) . '/';
	}
	if ( defined( 'WPMU_PLUGIN_DIR' ) ) {
		$dirs[] = wp_normalize_path( WPMU_PLUGIN_DIR ) . '/';
	}
	foreach ( (array) get_theme_roots() as $theme_root ) {

		$dirs[] = wp_normalize_path( get_theme_root( (string) $theme_root ) ) . '/';
	}
	$dirs = array_values( array_unique( array_filter( $dirs ) ) );
	return $dirs;
}

function openstation_registrant_file_from_backtrace() {
	$self_dir = defined( 'OPENSTATION_DIR' ) ? wp_normalize_path( OPENSTATION_DIR ) : '';
	$self_dir = $self_dir ? trailingslashit( $self_dir ) : '';
	$dirs     = openstation_extension_dirs();
	if ( empty( $dirs ) ) {
		return null;
	}

	$bt = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 20 );
	foreach ( $bt as $frame ) {
		if ( empty( $frame['file'] ) ) {
			continue;
		}
		$norm = wp_normalize_path( (string) $frame['file'] );
		if ( '' !== $self_dir && 0 === strpos( $norm, $self_dir ) ) {
			continue;
		}
		$norm = openstation_plugin_link_path( $norm );
		foreach ( $dirs as $dir ) {
			if ( 0 === strpos( $norm, $dir ) ) {
				return $norm;
			}
		}
	}
	return null;
}

function openstation_plugin_link_path( $path ) {
	global $wp_plugin_paths;

	foreach ( (array) $wp_plugin_paths as $link => $target ) {
		$target = trailingslashit( (string) $target );
		if ( 0 === strpos( $path, $target ) ) {
			return trailingslashit( (string) $link ) . substr( $path, strlen( $target ) );
		}
	}
	return $path;
}

add_action(
	'registered_post_type',
	static function ( $post_type ) {
		openstation_record_type_registrant( $post_type, 'post_type' );
	},
	9999,
	1
);

add_action(
	'registered_taxonomy',
	static function ( $taxonomy ) {
		openstation_record_type_registrant( $taxonomy, 'taxonomy' );
	},
	9999,
	1
);

function openstation_callback_source_file( $callback ) {
	if ( empty( $callback ) ) {
		return null;
	}
	try {
		if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			list( $class, $method ) = explode( '::', $callback, 2 );
			$ref                    = new ReflectionMethod( $class, $method );
		} elseif ( is_array( $callback ) && isset( $callback[0], $callback[1] ) ) {
			$ref = new ReflectionMethod( $callback[0], (string) $callback[1] );
		} elseif ( is_object( $callback ) && ! ( $callback instanceof Closure ) && method_exists( $callback, '__invoke' ) ) {
			$ref = new ReflectionMethod( $callback, '__invoke' );
		} elseif ( is_callable( $callback ) ) {
			$ref = new ReflectionFunction( $callback );
		} else {
			return null;
		}
		$file = $ref->getFileName();
		return $file ? $file : null;
	} catch ( ReflectionException $e ) {
		return null;
	}
}

function openstation_dock_placement( $menu_slug ) {

	$filtered = apply_filters( 'openstation_dock_placement', 'dock', $menu_slug );
	return 'hidden' === $filtered ? 'hidden' : 'dock';
}

function openstation_build_menu_payload() {
	$all = openstation_build_dock_items();

	$visible = array_values(
		array_filter(
			$all,
			static function ( $item ) {
				return 'hidden' !== ( $item['placement'] ?? 'dock' );
			}
		)
	);

	$core   = array();
	$plugin = array();
	foreach ( $visible as $item ) {
		if ( ! empty( $item['isCore'] ) ) {
			$core[] = $item;
		} else {
			$plugin[] = $item;
		}
	}

	$dock = array_merge( $core, $plugin );

	$native_windows = openstation_collect_native_windows_payload();

	$payload = array(
		'dockItems'              => $dock,
		'nativeWindows'          => $native_windows['windows'],
		'nativeWindowScriptData' => $native_windows['scriptData'],
	);

	$builders = array(
		'serverWidgets'                   => 'openstation_build_desktop_widgets_payload',
		'serverWallpapers'                => 'openstation_build_desktop_wallpapers_payload',
		'serverCommandScripts'            => 'openstation_build_desktop_command_scripts_payload',
		'serverCommands'                  => 'openstation_build_desktop_commands_payload',
		'serverSettingsTabScripts'        => 'openstation_build_desktop_settings_tab_scripts_payload',
		'serverSettingsTabs'              => 'openstation_build_desktop_settings_tabs_payload',
		'serverDockRailRendererScripts'   => 'openstation_build_dock_rail_renderer_scripts_payload',
		'serverTitleBarButtonScripts'     => 'openstation_build_desktop_titlebar_button_scripts_payload',
		'serverWindowActionScripts'       => 'openstation_build_desktop_window_action_scripts_payload',
		'serverUnfocusEffectScripts'      => 'openstation_build_desktop_unfocus_effect_scripts_payload',
		'serverWindowLinkRendererScripts' => 'openstation_build_window_link_renderer_scripts_payload',
		'serverWindowThemeScripts'        => 'openstation_build_window_theme_scripts_payload',
		'serverWindowThemes'              => 'openstation_build_window_themes_payload',
		'serverWindowControlScripts'      => 'openstation_build_window_control_scripts_payload',
		'serverWindowControls'            => 'openstation_build_window_controls_payload',
		'serverWindowSlotScripts'         => 'openstation_build_window_slot_scripts_payload',
		'serverWindowSlots'               => 'openstation_build_window_slots_payload',
		'serverWindowChromeScripts'       => 'openstation_build_window_chrome_scripts_payload',
		'serverWindowChromes'             => 'openstation_build_window_chromes_payload',
		'serverWindowNotices'             => 'openstation_build_window_notices_payload',
		'serverGames'                     => 'openstation_build_desktop_games_payload',
		'serverDesktopThemes'             => 'openstation_build_desktop_themes_payload',
		'desktopIcons'                    => 'openstation_build_desktop_icons_payload',
	);

	foreach ( $builders as $key => $builder ) {
		$payload[ $key ] = function_exists( $builder ) ? $builder() : array();
	}

	if ( function_exists( 'wp_get_update_data' ) ) {
		$update_data  = wp_get_update_data();
		$update_total = isset( $update_data['counts']['total'] ) ? (int) $update_data['counts']['total'] : 0;

		$payload['updateCounts'] = array(
			'total'     => $update_total,
			'formatted' => number_format_i18n( $update_total ),
			'text'      => sprintf(

				_n( '%s update available', '%s updates available', $update_total, 'desktop-mode' ),
				number_format_i18n( $update_total )
			),
			'url'       => network_admin_url( 'update-core.php' ),
		);
	}

	$payload['multisite'] = openstation_multisite_payload();

	$payload['menuSig'] = openstation_menu_signature();

	$script_dep_payloads          = array();
	$payload                      = openstation_compact_script_deps( $payload, $script_dep_payloads );
	$payload['scriptDepPayloads'] = (object) $script_dep_payloads;

	return $payload;
}

function openstation_menu_signature() {
	global $menu, $submenu;

	if ( empty( $menu ) || ! is_array( $menu ) ) {
		return '';
	}

	$clean_title = static function ( $raw ) {

		$stripped = preg_replace( '/<span[^>]*>.*?<\/span>/s', '', (string) $raw );
		return trim( wp_strip_all_tags( (string) $stripped ) );
	};

	$parts = array();

	foreach ( $menu as $item ) {
		if ( empty( $item[2] ) ) {
			continue;
		}
		if ( ! empty( $item[4] ) && false !== strpos( $item[4], 'wp-menu-separator' ) ) {
			continue;
		}
		if ( ! empty( $item[1] ) && ! current_user_can( $item[1] ) ) {
			continue;
		}

		$slug    = (string) $item[2];
		$parts[] = $slug . '|' . $clean_title( $item[0] ?? '' );

		if ( empty( $submenu[ $slug ] ) || ! is_array( $submenu[ $slug ] ) ) {
			continue;
		}
		foreach ( $submenu[ $slug ] as $sub_item ) {
			if ( ! empty( $sub_item[1] ) && ! current_user_can( $sub_item[1] ) ) {
				continue;
			}
			$parts[] = "\t" . ( isset( $sub_item[2] ) ? (string) $sub_item[2] : '' )
				. '|' . $clean_title( $sub_item[0] ?? '' );
		}
	}

	return md5( implode( "\n", $parts ) );
}

function openstation_script_dependency_closure( $dependencies, $handles ) {
	$seen = array();
	$out  = array();
	openstation_collect_script_dependency_closure( $dependencies, (array) $handles, $seen, $out );

	return $out;
}

function openstation_collect_script_dependency_closure( $dependencies, $handles, &$seen, &$out ) {
	foreach ( (array) $handles as $handle ) {
		if ( isset( $seen[ $handle ] ) ) {
			continue;
		}

		$seen[ $handle ] = true;
		if ( ! isset( $dependencies->registered[ $handle ] ) ) {
			continue;
		}
		openstation_collect_script_dependency_closure(
			$dependencies,
			$dependencies->registered[ $handle ]->deps,
			$seen,
			$out
		);
		$out[] = $handle;
	}
}

function openstation_resolve_script_dependencies( $handle ) {
	$handle     = (string) $handle;
	$wp_scripts = wp_scripts();
	if ( '' === $handle || ! $wp_scripts || ! isset( $wp_scripts->registered[ $handle ] ) ) {
		return array();
	}
	$deps = $wp_scripts->registered[ $handle ]->deps;
	if ( empty( $deps ) ) {
		return array();
	}

	$out = array();
	foreach ( openstation_script_dependency_closure( $wp_scripts, $deps ) as $dep_handle ) {
		if ( $dep_handle === $handle ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $dep_handle );

		if ( '' === $payload['url']
			&& empty( $payload['before'] )
			&& empty( $payload['after'] )
			&& empty( $payload['l10n'] ) ) {
			continue;
		}

		$payload['handle'] = (string) $dep_handle;
		$out[]             = $payload;
	}
	return $out;
}

function openstation_compact_script_deps( $payload, array &$map ) {
	if ( ! is_array( $payload ) ) {
		return $payload;
	}
	foreach ( $payload as $list_key => $entries ) {
		if ( ! is_array( $entries ) ) {
			continue;
		}
		foreach ( $entries as $entry_key => $entry ) {
			if ( ! is_array( $entry ) || ! isset( $entry['scriptDeps'] ) || ! is_array( $entry['scriptDeps'] ) ) {
				continue;
			}
			$payload[ $list_key ][ $entry_key ]['scriptDeps'] = openstation_compact_script_dep_list( $entry['scriptDeps'], $map );
		}
	}
	return $payload;
}

function openstation_compact_script_dep_list( array $deps, array &$map ) {
	$handles = array();
	foreach ( $deps as $dep ) {
		if ( is_string( $dep ) && '' !== $dep ) {
			if ( ! isset( $map[ $dep ] ) ) {
				$payload = openstation_resolve_script_payload( $dep );
				if ( '' === $payload['url']
					&& empty( $payload['before'] )
					&& empty( $payload['after'] )
					&& empty( $payload['l10n'] ) ) {
					continue;
				}
				$payload['handle'] = $dep;
				$map[ $dep ]       = $payload;
			}
			$handles[] = $dep;
			continue;
		}
		if ( is_array( $dep ) && isset( $dep['handle'] ) && '' !== (string) $dep['handle'] ) {
			$handle = (string) $dep['handle'];
			if ( ! isset( $map[ $handle ] ) ) {
				$map[ $handle ] = $dep;
			}
			$handles[] = $handle;
			continue;
		}

		$handles[] = $dep;
	}
	return $handles;
}

function openstation_resolve_script_payload( $handle ) {
	$empty = array(
		'url'          => '',
		'before'       => array(),
		'after'        => array(),
		'l10n'         => array(),
		'translations' => '',
	);

	$handle = (string) $handle;
	if ( '' === $handle ) {
		return $empty;
	}
	$wp_scripts = wp_scripts();
	if ( ! $wp_scripts || ! isset( $wp_scripts->registered[ $handle ] ) ) {
		return $empty;
	}
	$registered = $wp_scripts->registered[ $handle ];
	$src        = is_string( $registered->src ) ? $registered->src : '';

	$resolved = '';
	if ( '' !== $src ) {

		$resolved = $src;
		if ( 0 === strpos( $resolved, '/' ) && 0 !== strpos( $resolved, '//' ) ) {
			$resolved = site_url( $resolved );
		}
		if ( ! empty( $registered->ver ) ) {
			$resolved = add_query_arg( 'ver', $registered->ver, $resolved );
		}
	}

	$before = array();
	$after  = array();
	$l10n   = array();

	if ( isset( $registered->extra['before'] ) && is_array( $registered->extra['before'] ) ) {
		foreach ( $registered->extra['before'] as $code ) {
			$code = (string) $code;
			if ( '' !== $code ) {
				$before[] = $code;
			}
		}
	}
	if ( isset( $registered->extra['after'] ) && is_array( $registered->extra['after'] ) ) {
		foreach ( $registered->extra['after'] as $code ) {
			$code = (string) $code;
			if ( '' !== $code ) {
				$after[] = $code;
			}
		}
	}

	if ( ! empty( $registered->extra['data'] ) && is_string( $registered->extra['data'] ) ) {
		$l10n[] = $registered->extra['data'];
	}

	$translations = '';
	if ( '' !== $resolved && method_exists( $wp_scripts, 'print_translations' ) ) {
		$captured = $wp_scripts->print_translations( $handle, false );
		if ( is_string( $captured ) ) {
			$translations = $captured;
		}
	}

	return array(
		'url'          => $resolved,
		'before'       => $before,
		'after'        => $after,
		'l10n'         => $l10n,
		'translations' => $translations,
	);
}

function openstation_resolve_style_payload( $handle ) {
	$empty = array(
		'url'    => '',
		'inline' => array(),
	);

	$handle = (string) $handle;
	if ( '' === $handle ) {
		return $empty;
	}
	$wp_styles = wp_styles();
	if ( ! $wp_styles || ! isset( $wp_styles->registered[ $handle ] ) ) {
		return $empty;
	}
	$registered = $wp_styles->registered[ $handle ];
	$src        = is_string( $registered->src ) ? $registered->src : '';
	if ( '' === $src ) {
		return $empty;
	}

	$resolved = $src;
	if ( 0 === strpos( $resolved, '/' ) && 0 !== strpos( $resolved, '//' ) ) {
		$resolved = site_url( $resolved );
	}
	if ( ! empty( $registered->ver ) ) {
		$resolved = add_query_arg( 'ver', $registered->ver, $resolved );
	}

	$inline = array();
	if ( isset( $registered->extra['after'] ) && is_array( $registered->extra['after'] ) ) {
		foreach ( $registered->extra['after'] as $code ) {
			$code = (string) $code;
			if ( '' !== $code ) {
				$inline[] = $code;
			}
		}
	}

	return array(
		'url'    => $resolved,
		'inline' => $inline,
	);
}

function openstation_build_command_palette_assets_payload() {
	if ( ! function_exists( 'wp_enqueue_command_palette_assets' ) ) {
		return null;
	}
	$scripts = wp_scripts();
	$styles  = wp_styles();
	if ( ! $scripts || ! $styles ) {
		return null;
	}

	global $menu, $submenu;

	if ( ! isset( $submenu ) || ! is_array( $submenu ) ) {
		$submenu = array();
	}
	if ( ! isset( $menu ) || ! is_array( $menu ) ) {
		$menu = array();
	}

	$script_queue_before = $scripts->queue;
	$style_queue_before  = $styles->queue;

	wp_enqueue_command_palette_assets();

	$script_roots = array_values( array_diff( $scripts->queue, $script_queue_before ) );
	$style_roots  = array_values( array_diff( $styles->queue, $style_queue_before ) );

	$scripts->queue = $script_queue_before;
	$styles->queue  = $style_queue_before;

	$out = array(
		'scripts' => array(),
		'styles'  => array(),
	);

	$script_probe        = clone $scripts;
	$script_probe->to_do = array();
	$script_probe->done  = array();
	$script_probe->all_deps( $script_roots );
	foreach ( $script_probe->to_do as $handle ) {
		$payload = openstation_resolve_script_payload( $handle );

		if ( '' === $payload['url']
			&& empty( $payload['before'] )
			&& empty( $payload['after'] )
			&& empty( $payload['l10n'] ) ) {
			continue;
		}

		if ( 'wp-core-commands' === $handle ) {
			foreach ( array( 'before', 'after' ) as $position ) {
				$payload[ $position ] = array_values(
					array_filter(
						$payload[ $position ],
						static function ( $snippet ) {
							return false === strpos( (string) $snippet, 'initializeCommandPalette(' );
						}
					)
				);
			}
			$payload['after'][] = sprintf(
				'wp.coreCommands.initializeCommandPalette({"is_network_admin":%s,"menu_commands":window.__openStationMenuCommands||[]});',
				is_network_admin() ? 'true' : 'false'
			);
		}

		$out['scripts'][] = array(
			'handle'       => (string) $handle,
			'url'          => $payload['url'],
			'before'       => $payload['before'],
			'after'        => $payload['after'],
			'l10n'         => $payload['l10n'],
			'translations' => $payload['translations'],
		);
	}

	$style_probe        = clone $styles;
	$style_probe->to_do = array();
	$style_probe->done  = array();
	$style_probe->all_deps( $style_roots );
	foreach ( $style_probe->to_do as $handle ) {
		$style_payload = openstation_resolve_style_payload( $handle );
		if ( '' === $style_payload['url'] ) {
			continue;
		}
		$out['styles'][] = array(
			'handle' => (string) $handle,
			'url'    => $style_payload['url'],
			'inline' => $style_payload['inline'],
		);
	}

	return $out;
}

function openstation_build_deferred_styles( $handles ) {
	$out = array();
	foreach ( (array) $handles as $handle ) {
		$handle  = (string) $handle;
		$payload = openstation_resolve_style_payload( $handle );
		if ( '' === $payload['url'] ) {
			continue;
		}
		$out[ $handle ] = $payload;
	}
	return $out;
}

function openstation_warn_unresolvable_script_handle( $function_name, $kind, $handle ) {
	static $warned = array();
	$cache_key     = $function_name . '|' . $handle;
	if ( isset( $warned[ $cache_key ] ) ) {
		return;
	}
	$warned[ $cache_key ] = true;

	if ( '__flush__' === $handle ) {

		$warned = array();
		return;
	}

	_doing_it_wrong(
		esc_html( $function_name ),
		sprintf(

			esc_html__( '%1$s script handle "%2$s" could not be resolved: no `wp_register_script( \'%2$s\', … )` call had run by the time the shell harvested its payload. Register the handle on `admin_enqueue_scripts` at priority 5 or earlier — the harvest itself runs at priority 10, and a handle registered alongside it may or may not exist yet depending on plugin load order. Until then the script will not load.', 'desktop-mode' ),
			esc_html( $kind ),
			esc_html( $handle )
		),
		'0.8.1'
	);
}

function openstation_flush_script_handle_registries() {
	$flushers = array(
		'openstation_flush_desktop_command_script_registry',
		'openstation_flush_desktop_settings_tab_script_registry',
		'openstation_flush_dock_rail_renderer_script_registry',
		'openstation_flush_desktop_titlebar_button_script_registry',
		'openstation_flush_desktop_window_action_script_registry',
		'openstation_flush_desktop_unfocus_effect_script_registry',
		'openstation_flush_window_link_renderer_script_registry',
		'openstation_flush_window_theme_script_registry',
		'openstation_flush_window_theme_registry',
		'openstation_flush_window_control_script_registry',
		'openstation_flush_window_control_registry',
		'openstation_flush_window_slot_script_registry',
		'openstation_flush_window_slot_registry',
		'openstation_flush_window_chrome_script_registry',
		'openstation_flush_window_chrome_registry',
		'openstation_flush_window_notice_registry',
	);

	foreach ( $flushers as $flusher ) {
		if ( function_exists( $flusher ) ) {
			$flusher();
		}
	}

	openstation_warn_unresolvable_script_handle( '', '', '__flush__' );
}

function openstation_collect_native_windows_payload() {
	$empty = array(
		'windows'    => array(),
		'scriptData' => array(),
	);
	if ( ! function_exists( 'openstation_native_window_registry' ) ) {
		return $empty;
	}

	$registry = openstation_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return $empty;
	}

	$registry = array_filter( $registry, 'openstation_native_window_offered_here' );

	$script_data = array();

	$resolved_as_bundle = array();

	$collect_handle = static function ( $handle ) use ( &$script_data, &$resolved_as_bundle ) {
		$handle = (string) $handle;
		if ( '' === $handle ) {
			return '';
		}
		if ( isset( $resolved_as_bundle[ $handle ] ) ) {
			return $resolved_as_bundle[ $handle ];
		}
		$payload = isset( $script_data[ $handle ] )
			? $script_data[ $handle ]
			: openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			$resolved_as_bundle[ $handle ] = '';
			return '';
		}
		$resolved_as_bundle[ $handle ] = $handle;
		$deps                          = array();
		foreach ( openstation_resolve_script_dependencies( $handle ) as $dep ) {
			$dep_handle = (string) $dep['handle'];
			unset( $dep['handle'] );
			if ( ! isset( $script_data[ $dep_handle ] ) ) {
				$dep['deps']                = array();
				$script_data[ $dep_handle ] = $dep;
			}
			$deps[] = $dep_handle;
		}
		$payload['deps']        = $deps;
		$script_data[ $handle ] = $payload;
		return $handle;
	};

	$config_snippets_by_handle = array();
	foreach ( $registry as $entry ) {
		$handle = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		if ( '' === $handle || ! is_callable( $entry['template'] ) ) {
			continue;
		}
		$window_config = openstation_filter_native_window_config( $entry );
		if ( empty( $window_config ) ) {
			continue;
		}
		$config_snippets_by_handle[ $handle ][ $entry['id'] ] = sprintf(
			'window.openStationWindowConfig=window.openStationWindowConfig||{};window.openStationWindowConfig[%s]=%s;',
			wp_json_encode( $entry['id'] ),
			wp_json_encode( $window_config )
		);
	}

	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_callable( $entry['template'] ) ) {
			continue;
		}

		$template_html = openstation_build_native_window_template_html( $entry );

		$declared_script = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$script_handle   = $collect_handle( $declared_script );
		$owner_handle    = '' !== $script_handle ? $script_handle : $declared_script;

		$companion_scripts = array();
		if ( ! empty( $entry['scripts'] ) && is_array( $entry['scripts'] ) ) {
			foreach ( $entry['scripts'] as $companion_handle ) {
				$companion_handle = $collect_handle( $companion_handle );
				if ( '' !== $companion_handle ) {
					$companion_scripts[] = $companion_handle;
				}
			}
		}

		$style_handle  = isset( $entry['style'] ) ? (string) $entry['style'] : '';
		$style_payload = openstation_resolve_style_payload( $style_handle );

		$companion_styles = array();
		if ( ! empty( $entry['styles'] ) && is_array( $entry['styles'] ) ) {
			foreach ( $entry['styles'] as $companion_style_handle ) {
				$companion_style_handle  = (string) $companion_style_handle;
				$companion_style_payload = openstation_resolve_style_payload( $companion_style_handle );
				if ( '' === $companion_style_payload['url'] ) {
					continue;
				}
				$companion_styles[] = array(
					'styleUrl'    => $companion_style_payload['url'],
					'styleHandle' => $companion_style_handle,
					'styleInline' => $companion_style_payload['inline'],
				);
			}
		}

		$tab_descriptors = array();
		if ( function_exists( 'openstation_get_native_window_tabs' ) ) {
			foreach ( openstation_get_native_window_tabs( $entry['id'] ) as $tab ) {
				$tab_descriptors[] = array(
					'value'        => $tab['value'],
					'label'        => $tab['label'],
					'isMain'       => $tab['is_main'],
					'scriptHandle' => $collect_handle( $tab['script'] ),
				);
			}
		}

		$out[] = array(
			'id'               => $entry['id'],
			'title'            => $entry['title'],
			'icon'             => $entry['icon'],
			'placement'        => $entry['placement'],

			'navKind'          => isset( $entry['nav_kind'] ) ? $entry['nav_kind'] : 'app',

			'dockOrder'        => isset( $entry['dock_order'] ) ? (int) $entry['dock_order'] : 0,
			'placeable'        => ! empty( $entry['placeable'] ),
			'width'            => $entry['width'],
			'height'           => $entry['height'],
			'minWidth'         => $entry['min_width'],
			'minHeight'        => $entry['min_height'],
			'autofocus'        => $entry['autofocus'],
			'templateId'       => 'os-native-window-' . $entry['id'],
			'templateHtml'     => $template_html,
			'scriptHandle'     => $script_handle,
			'ownerHandle'      => $owner_handle,
			'companionScripts' => $companion_scripts,

			'preloadScript'    => ! empty( $entry['preload_script'] ),
			'styleUrl'         => $style_payload['url'],
			'styleHandle'      => $style_handle,
			'styleInline'      => $style_payload['inline'],
			'companionStyles'  => $companion_styles,
			'tabs'             => $tab_descriptors,
			'menuPages'        => isset( $entry['menu_pages'] ) ? array_values( (array) $entry['menu_pages'] ) : array(),
		);
	}

	foreach ( $config_snippets_by_handle as $handle => $snippets ) {
		if ( ! isset( $script_data[ $handle ] ) ) {
			continue;
		}
		foreach ( $snippets as $snippet ) {
			$script_data[ $handle ]['l10n'][] = $snippet;
		}
	}

	return array(
		'windows'    => $out,
		'scriptData' => $script_data,
	);
}

function openstation_build_native_windows_payload() {
	$bundle = openstation_collect_native_windows_payload();
	return $bundle['windows'];
}

function openstation_menu_item_title( $raw_title ) {
	$stripped = preg_replace( '/<span[^>]*>.*?<\/span>/s', '', (string) $raw_title );

	return trim( wp_strip_all_tags( $stripped ) );
}

function openstation_is_admin_file_slug( $slug ) {
	$file = $slug;
	$pos  = strpos( $file, '?' );
	if ( false !== $pos ) {
		$file = substr( $file, 0, $pos );
	}

	if ( '' === $file || 0 !== validate_file( $file ) ) {
		return false;
	}

	return file_exists( ABSPATH . 'wp-admin/' . $file );
}

function openstation_menu_admin_url( $path = '' ) {
	if ( is_network_admin() ) {
		return network_admin_url( $path );
	}
	if ( is_user_admin() ) {
		return user_admin_url( $path );
	}
	return admin_url( $path );
}

function openstation_menu_item_url( $slug ) {

	if ( str_starts_with( $slug, 'http://' ) || str_starts_with( $slug, 'https://' ) ) {
		return esc_url_raw( $slug );
	}

	$slug = str_replace( '..', '', $slug );

	global $_parent_pages;

	if (
		false !== strpos( $slug, '.php' ) &&
		( ! isset( $_parent_pages[ $slug ] ) || openstation_is_admin_file_slug( $slug ) )
	) {
		return esc_url_raw( openstation_menu_admin_url( $slug ) );
	}

	$extra_args = array();
	if ( false !== strpos( $slug, '&' ) ) {
		list( $slug, $tail ) = array_pad( explode( '&', $slug, 2 ), 2, '' );
		if ( '' !== $tail ) {
			parse_str( $tail, $extra_args );
		}
	}

	$host = 'admin.php?page=' . rawurlencode( $slug );
	if ( isset( $_parent_pages[ $slug ] ) ) {
		$parent_slug = $_parent_pages[ $slug ];
		if ( $parent_slug && ! isset( $_parent_pages[ $parent_slug ] ) ) {
			$host = add_query_arg( 'page', $slug, $parent_slug );
		}
	}

	$url = openstation_menu_admin_url( $host );
	if ( ! empty( $extra_args ) ) {
		$url = add_query_arg( $extra_args, $url );
	}
	return esc_url_raw( $url );
}
