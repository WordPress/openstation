<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_post_type_group( $post_type ) {
	$group = null;

	if ( function_exists( 'openstation_type_registrant_file' ) ) {
		$file = openstation_type_registrant_file( (string) $post_type, 'post_type' );
		if ( null !== $file ) {
			$group = openstation_my_wordpress_group_for_path( $file );
		}
	}

	$group = apply_filters( 'openstation_my_wordpress_post_type_group', $group, $post_type );

	return is_array( $group ) && ! empty( $group['id'] ) ? $group : null;
}

function openstation_my_wordpress_group_for_path( $file ) {
	$path = wp_normalize_path( (string) $file );
	if ( '' === $path ) {
		return null;
	}

	if ( defined( 'WPMU_PLUGIN_DIR' ) ) {
		$mu_dir = trailingslashit( wp_normalize_path( WPMU_PLUGIN_DIR ) );
		if ( 0 === strpos( $path, $mu_dir ) ) {
			$rel  = ltrim( substr( $path, strlen( $mu_dir ) ), '/' );
			$slug = ( false !== strpos( $rel, '/' ) ) ? strtok( $rel, '/' ) : $rel;
			if ( '' === $slug ) {
				return null;
			}
			$name = openstation_my_wordpress_plugin_header_name( $mu_dir . $rel );
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

				$name = openstation_my_wordpress_plugin_header_name( $plugins_dir . $rel );
				return array(
					'id'    => 'plugin:' . $rel,
					'label' => '' !== $name ? $name : $rel,
					'icon'  => 'dashicons-admin-plugins',
					'order' => 20,
				);
			}
			return array(
				'id'    => 'plugin:' . $folder,
				'label' => openstation_my_wordpress_plugin_folder_name( $folder ),
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
		$rel        = ltrim( substr( $path, strlen( $root ) ), '/' );
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

function openstation_my_wordpress_plugin_folder_name( $folder ) {
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
		$name = openstation_my_wordpress_plugin_header_name( $norm );
		break;
	}

	$cache[ $slug ] = '' !== $name ? $name : $slug;
	return $cache[ $slug ];
}

function openstation_my_wordpress_plugin_header_name( $file ) {
	if ( ! is_string( $file ) || '' === $file || ! is_readable( $file ) ) {
		return '';
	}
	$data = get_file_data( $file, array( 'Name' => 'Plugin Name' ), 'plugin' );
	return isset( $data['Name'] ) ? trim( (string) $data['Name'] ) : '';
}

function openstation_my_wordpress_collect_groups( $entities ) {
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

	$filtered = apply_filters( 'openstation_my_wordpress_post_type_groups', $groups, $entities );

	return is_array( $filtered ) ? array_values( $filtered ) : $groups;
}
