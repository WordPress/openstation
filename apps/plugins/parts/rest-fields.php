<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const OPENSTATION_PLUGINS_CACHE_GROUP = 'desktop-mode-plugins';

const OPENSTATION_PLUGINS_SIZE_TRANSIENT = 'dm_pwsz_map';

function openstation_plugins_window_register_rest_fields() {
	$fields = array(
		'openstation_update_available' => array(
			'callback'    => 'openstation_plugins_window_field_update_available',
			'description' => __( 'Whether an update is available for this plugin (and the available version).', 'desktop-mode' ),
			'type'        => 'object',
		),
		'openstation_can_manage'       => array(
			'callback'    => 'openstation_plugins_window_field_can_manage',
			'description' => __( 'Per-plugin capability flags for the requester (activate / deactivate / delete).', 'desktop-mode' ),
			'type'        => 'object',
		),
		'openstation_wporg_slug'       => array(
			'callback'    => 'openstation_plugins_window_field_wporg_slug',
			'description' => __( 'The plugin\'s slug on the WordPress.org directory, or null when the plugin is not listed there.', 'desktop-mode' ),
			'type'        => array( 'string', 'null' ),
		),
		'openstation_icon_url'         => array(
			'callback'    => 'openstation_plugins_window_field_icon_url',
			'description' => __( 'Best-effort card icon URL. Prefers a local file in the plugin folder, falling back to the wp.org SVN URL; null when neither resolves.', 'desktop-mode' ),
			'type'        => array( 'string', 'null' ),
		),
		'openstation_size_kb'          => array(
			'callback'    => 'openstation_plugins_window_field_size_kb',
			'description' => __( 'Approximate disk footprint of the plugin folder, in kilobytes (cached 6h).', 'desktop-mode' ),
			'type'        => array( 'integer', 'null' ),
		),
		'openstation_auto_update'      => array(
			'callback'    => 'openstation_plugins_window_field_auto_update',
			'description' => __( 'Auto-update state for this plugin (enabled / forced / supported), mirroring Core\'s plugins.php column.', 'desktop-mode' ),
			'type'        => 'object',
		),
	);
	foreach ( $fields as $name => $field ) {
		register_rest_field(
			'plugin',
			$name,
			array(
				'get_callback' => $field['callback'],
				'schema'       => array(
					'description' => $field['description'],
					'type'        => $field['type'],
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'openstation_plugins_window_register_rest_fields' );

function openstation_plugins_window_row_plugin_file( $row ) {
	$file = isset( $row['plugin'] ) ? (string) $row['plugin'] : '';
	if ( '' === $file ) {
		return '';
	}
	if ( '.php' !== substr( $file, -4 ) ) {
		$file .= '.php';
	}
	return $file;
}

function openstation_plugins_window_field_can_manage( $row ) {
	static $caps = null;
	if ( null === $caps || ! isset( $caps['user'] ) || get_current_user_id() !== $caps['user'] ) {
		$caps = array(
			'user'     => get_current_user_id(),
			'activate' => current_user_can( 'activate_plugins' ),

			'delete'   => ! is_multisite() && current_user_can( 'delete_plugins' ),
			'network'  => current_user_can( 'manage_network_plugins' ),
		);
	}
	$status = isset( $row['status'] ) ? (string) $row['status'] : '';

	$deactivate = false;
	if ( 'active' === $status ) {
		$deactivate = $caps['activate'];
	} elseif ( 'network-active' === $status ) {
		$deactivate = $caps['activate'] && $caps['network'];
	}

	return array(
		'activate'   => $caps['activate'] && 'inactive' === $status,
		'deactivate' => $deactivate,

		'delete'     => $caps['delete'] && 'inactive' === $status,
	);
}

function openstation_plugins_window_field_size_kb( $row ) {
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return null;
	}

	$root = WP_PLUGIN_DIR . '/' . dirname( $plugin_file );
	if ( '.' === dirname( $plugin_file ) || ! is_dir( $root ) ) {

		$candidate = WP_PLUGIN_DIR . '/' . $plugin_file;
		if ( is_file( $candidate ) ) {
			$bytes = (int) filesize( $candidate );
			return $bytes > 0 ? max( 1, (int) round( $bytes / 1024 ) ) : 0;
		}
		return null;
	}

	$map = openstation_plugins_window_size_map();
	if ( isset( $map[ $plugin_file ] ) && is_int( $map[ $plugin_file ] ) ) {
		return $map[ $plugin_file ];
	}

	$kb = openstation_plugins_window_compute_dir_size_kb( $root );
	openstation_plugins_window_size_map( $plugin_file, $kb );
	return $kb;
}

function openstation_plugins_window_size_map( $plugin_file = '', $kb = null ) {
	static $map   = null;
	static $dirty = false;
	if ( null === $map ) {
		$stored = get_transient( OPENSTATION_PLUGINS_SIZE_TRANSIENT );
		$map    = is_array( $stored ) ? $stored : array();
	}
	if ( '' !== $plugin_file && null !== $kb ) {
		$map[ $plugin_file ] = (int) $kb;
		if ( ! $dirty ) {
			$dirty = true;
			add_action(
				'shutdown',
				static function () use ( &$map ) {
					set_transient( OPENSTATION_PLUGINS_SIZE_TRANSIENT, $map, 6 * HOUR_IN_SECONDS );
				}
			);
		}
	}
	return $map;
}

function openstation_plugins_window_forget_sizes() {
	delete_transient( OPENSTATION_PLUGINS_SIZE_TRANSIENT );
}
add_action( 'deleted_plugin', 'openstation_plugins_window_forget_sizes' );
add_action(
	'upgrader_process_complete',
	static function ( $upgrader, $hook_extra ) {
		if ( is_array( $hook_extra ) && isset( $hook_extra['type'] ) && 'plugin' === $hook_extra['type'] ) {
			openstation_plugins_window_forget_sizes();
		}
	},
	10,
	2
);

function openstation_plugins_window_compute_dir_size_kb( $dir ) {
	if ( ! is_dir( $dir ) ) {
		return 0;
	}

	$total_bytes = 0;
	$visited     = 0;
	$max_visit   = 5000;

	$stack = array( $dir );
	while ( ! empty( $stack ) && $visited < $max_visit ) {
		$current = array_pop( $stack );
		$entries = @scandir( $current );
		if ( ! is_array( $entries ) ) {
			continue;
		}
		foreach ( $entries as $entry ) {
			if ( '.' === $entry || '..' === $entry ) {
				continue;
			}
			$path = $current . '/' . $entry;
			if ( is_link( $path ) ) {

				continue;
			}
			++$visited;
			if ( $visited >= $max_visit ) {
				break 2;
			}
			if ( is_dir( $path ) ) {
				$stack[] = $path;
			} elseif ( is_file( $path ) ) {
				$total_bytes += (int) filesize( $path );
			}
		}
	}

	return $total_bytes > 0 ? max( 1, (int) round( $total_bytes / 1024 ) ) : 0;
}
