<?php
/**
 * OpenStation — My WordPress: post-type ownership → folder groups.
 *
 * Custom post types are grouped in the site window by whoever
 * registered them: a plugin's CPTs share one folder named after the
 * plugin, a theme's CPTs share a folder named after the theme, and
 * anything unattributable stays loose at the root alongside Posts and
 * Pages.
 *
 * Attribution reads the registration-time file path captured by
 * `open_station_record_type_registrant()` (`includes/core/payload.php`),
 * which hooks `registered_post_type` and walks the backtrace to the
 * first frame inside an extension directory.
 *
 * Display names are resolved WITHOUT `get_plugins()`. That function
 * lives in `wp-admin/includes/plugin.php`, which Core only loads after
 * `init` has already run — and it scans the whole plugins directory,
 * which is not a cost worth paying on every admin request. Plugin
 * headers are read straight from the main file with `get_file_data()`
 * (first 8 KB only) and themes via `wp_get_theme()`, both of which live
 * in `wp-includes` and are always available.
 *
 * Filterable surface:
 *
 *   - `open_station_my_wordpress_post_type_group`
 *   - `open_station_my_wordpress_post_type_groups`
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve the folder group a post type belongs to.
 *
 * @param string $post_type Post type slug.
 * @return array|null Group descriptor with `id`, `label`, `icon`, and
 *                    `order` keys, or null when the type should sit
 *                    loose at the root.
 */
function open_station_my_wordpress_post_type_group( $post_type ) {
	$group = null;

	if ( function_exists( 'open_station_type_registrant_file' ) ) {
		$file = open_station_type_registrant_file( (string) $post_type, 'post_type' );
		if ( null !== $file ) {
			$group = open_station_my_wordpress_group_for_path( $file );
		}
	}

	/**
	 * Filter the folder group resolved for a single post type.
	 *
	 * Return null to pull the type out of its folder and render it
	 * loose at the root of the site window, or return a descriptor
	 * (`id`, `label`, `icon`, `order`) to override the attribution —
	 * useful for a suite of plugins that should share one folder.
	 *
	 * **Status: Experimental** — the descriptor may gain fields.
	 *
	 * @param array|null $group     Resolved group descriptor, or null.
	 * @param string     $post_type Post type slug.
	 */
	$group = apply_filters( 'open_station_my_wordpress_post_type_group', $group, $post_type );

	return is_array( $group ) && ! empty( $group['id'] ) ? $group : null;
}

/**
 * Map an absolute registration path to a group descriptor.
 *
 * @param string $file Normalized absolute path.
 * @return array|null Group descriptor or null.
 */
function open_station_my_wordpress_group_for_path( $file ) {
	$path = wp_normalize_path( (string) $file );
	if ( '' === $path ) {
		return null;
	}

	// mu-plugins first: on some installs `WPMU_PLUGIN_DIR` sits inside
	// a path that also prefix-matches a theme root, and a mu-plugin is
	// the more specific answer.
	if ( defined( 'WPMU_PLUGIN_DIR' ) ) {
		$mu_dir = trailingslashit( wp_normalize_path( WPMU_PLUGIN_DIR ) );
		if ( 0 === strpos( $path, $mu_dir ) ) {
			$rel  = ltrim( substr( $path, strlen( $mu_dir ) ), '/' );
			$slug = ( false !== strpos( $rel, '/' ) ) ? strtok( $rel, '/' ) : $rel;
			if ( '' === $slug ) {
				return null;
			}
			$name = open_station_my_wordpress_plugin_header_name( $mu_dir . $rel );
			return array(
				'id'    => 'mu-plugin:' . $slug,
				'label' => '' !== $name ? $name : $slug,
				'icon'  => 'dashicons-admin-plugins',
				'order' => 20,
			);
		}
	}

	if ( defined( 'WP_PLUGIN_DIR' ) ) {
		$plugins_dir = trailingslashit( wp_normalize_path( WP_PLUGIN_DIR ) );
		if ( 0 === strpos( $path, $plugins_dir ) ) {
			$rel    = ltrim( substr( $path, strlen( $plugins_dir ) ), '/' );
			$folder = ( false !== strpos( $rel, '/' ) ) ? strtok( $rel, '/' ) : '';
			if ( '' === $folder ) {
				// Single-file plugin living directly in `plugins/`.
				$name = open_station_my_wordpress_plugin_header_name( $plugins_dir . $rel );
				return array(
					'id'    => 'plugin:' . $rel,
					'label' => '' !== $name ? $name : $rel,
					'icon'  => 'dashicons-admin-plugins',
					'order' => 20,
				);
			}
			return array(
				'id'    => 'plugin:' . $folder,
				'label' => open_station_my_wordpress_plugin_folder_name( $folder ),
				'icon'  => 'dashicons-admin-plugins',
				'order' => 20,
			);
		}
	}

	foreach ( (array) get_theme_roots() as $theme_root ) {
		$root = trailingslashit( wp_normalize_path( get_theme_root( (string) $theme_root ) ) );
		if ( 0 !== strpos( $path, $root ) ) {
			continue;
		}
		$rel   = ltrim( substr( $path, strlen( $root ) ), '/' );
		$stylesheet = ( false !== strpos( $rel, '/' ) ) ? strtok( $rel, '/' ) : $rel;
		if ( '' === $stylesheet ) {
			continue;
		}
		$theme = wp_get_theme( $stylesheet );
		$name  = $theme->exists() ? (string) $theme->get( 'Name' ) : '';
		return array(
			'id'    => 'theme:' . $stylesheet,
			'label' => '' !== $name ? $name : $stylesheet,
			'icon'  => 'dashicons-admin-appearance',
			'order' => 30,
		);
	}

	return null;
}

/**
 * Human-readable name for an active plugin folder.
 *
 * Matches the folder against `wp_get_active_and_valid_plugins()` — which
 * returns absolute paths to each active plugin's main file and is
 * available on every request — then reads the `Plugin Name` header from
 * that file. Falls back to the folder slug when the plugin isn't active
 * or carries no header (a CPT registered from an inactive plugin folder
 * is possible via `require`).
 *
 * @param string $folder Plugin folder name.
 * @return string Display name.
 */
function open_station_my_wordpress_plugin_folder_name( $folder ) {
	$slug = (string) $folder;
	if ( '' === $slug ) {
		return '';
	}

	static $cache = array();
	if ( isset( $cache[ $slug ] ) ) {
		return $cache[ $slug ];
	}

	$name = '';
	foreach ( (array) wp_get_active_and_valid_plugins() as $main_file ) {
		$norm = wp_normalize_path( (string) $main_file );
		$rel  = ltrim( str_replace( trailingslashit( wp_normalize_path( WP_PLUGIN_DIR ) ), '', $norm ), '/' );
		if ( 0 !== strpos( $rel, $slug . '/' ) ) {
			continue;
		}
		$name = open_station_my_wordpress_plugin_header_name( $norm );
		break;
	}

	$cache[ $slug ] = '' !== $name ? $name : $slug;
	return $cache[ $slug ];
}

/**
 * Read the `Plugin Name` header from a plugin file.
 *
 * @param string $file Absolute path to a PHP file.
 * @return string Plugin name, or an empty string.
 */
function open_station_my_wordpress_plugin_header_name( $file ) {
	if ( ! is_string( $file ) || '' === $file || ! is_readable( $file ) ) {
		return '';
	}
	$data = get_file_data( $file, array( 'Name' => 'Plugin Name' ), 'plugin' );
	return isset( $data['Name'] ) ? trim( (string) $data['Name'] ) : '';
}

/**
 * Collect the distinct groups referenced by a set of entity
 * descriptors, in render order.
 *
 * The bundle renders one folder tile per entry and drills into it via
 * the `group` route. Ordering is `order` ascending, then label, so
 * plugin folders cluster ahead of theme folders.
 *
 * @param array[] $entities Entity descriptors.
 * @return array[] Group descriptors, ordered.
 */
function open_station_my_wordpress_collect_groups( $entities ) {
	$groups = array();

	foreach ( (array) $entities as $entity ) {
		if ( empty( $entity['group'] ) ) {
			continue;
		}
		$id = (string) $entity['group'];
		if ( isset( $groups[ $id ] ) ) {
			continue;
		}
		$groups[ $id ] = array(
			'id'    => $id,
			'label' => isset( $entity['groupLabel'] ) ? (string) $entity['groupLabel'] : $id,
			'icon'  => isset( $entity['groupIcon'] ) ? (string) $entity['groupIcon'] : 'dashicons-admin-plugins',
			'order' => isset( $entity['groupOrder'] ) ? (int) $entity['groupOrder'] : 20,
		);
	}

	$groups = array_values( $groups );
	usort(
		$groups,
		static function ( $a, $b ) {
			if ( $a['order'] === $b['order'] ) {
				return strnatcasecmp( $a['label'], $b['label'] );
			}
			return $a['order'] < $b['order'] ? -1 : 1;
		}
	);

	/**
	 * Filter the folder groups shown at the root of the site window.
	 *
	 * Each entry declares `id`, `label`, `icon`, and `order`. Removing
	 * an entry does not hide its post types — they fall back to
	 * rendering loose at the root. To move a type between folders,
	 * use `open_station_my_wordpress_post_type_group` instead.
	 *
	 * **Status: Experimental** — the descriptor may gain fields.
	 *
	 * @param array[] $groups   Ordered group descriptors.
	 * @param array[] $entities The entity descriptors they were derived from.
	 */
	$filtered = apply_filters( 'open_station_my_wordpress_post_type_groups', $groups, $entities );

	return is_array( $filtered ) ? array_values( $filtered ) : $groups;
}
