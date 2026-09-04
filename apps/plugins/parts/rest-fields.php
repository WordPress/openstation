<?php
/**
 * Plugins app — the REST fields on Core's plugin resource.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. Registers the enrichment fields on Core's
 * `/wp/v2/plugins` resource so the app's `data()` (an in-process read
 * of that collection) renders rich rows in one round trip, and owns
 * the two that need no wp.org data: the per-row capability flags and
 * the folder size. The update-derived fields are `updates.php`, the
 * icon is `icons.php`.
 *
 *   - openstation_update_available — `{ available, new_version, package, slug }`
 *   - openstation_can_manage       — `{ activate, deactivate, delete }`
 *   - openstation_wporg_slug       — .org directory slug, or null when not listed
 *   - openstation_icon_url         — local-folder icon, falling back to wp.org
 *   - openstation_size_kb          — disk size of the plugin folder
 *   - openstation_auto_update      — `{ enabled, forced, supported }`
 *
 * Every callback uses only `wp-includes/` functions, so REST is the
 * right home — registering on `rest_api_init` keeps the contract
 * consistent with Core's other plugin REST decorators.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/** The per-request cache group the field callbacks memoise in. */
const OPENSTATION_PLUGINS_CACHE_GROUP = 'desktop-mode-plugins';

/** The transient holding every plugin folder's size, `{ file => kb }`. */
const OPENSTATION_PLUGINS_SIZE_TRANSIENT = 'dm_pwsz_map';

/**
 * Register the six enrichment fields on the `plugin` REST resource.
 */
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

/**
 * Resolve the plugin file path (relative to `WP_PLUGIN_DIR`, ending in
 * `.php`) for a Core REST plugin row.
 *
 * Core's `WP_REST_Plugins_Controller::prepare_item_for_response` emits
 * the `plugin` field with the trailing `.php` STRIPPED — e.g.
 * `"elementor/elementor"` — while every internal WordPress structure
 * that keys off the plugin file (the `update_plugins` transient, the
 * `active_plugins` option, `plugin_basename()`, `WP_PLUGIN_DIR` paths)
 * uses the full filename. Mixing the two yields silent lookup misses.
 *
 * @param array $row Core REST plugin row.
 * @return string Plugin file (e.g. `"elementor/elementor.php"`), or `''`
 *                when the row has no `plugin` field.
 */
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

/**
 * `openstation_can_manage` callback.
 *
 * Per-row cap surface so the client can hide actions the viewer can't
 * perform without re-deriving caps. The server still re-validates
 * every mutation. A network-activated plugin (`network-active`, a
 * status only a network has) is deactivated from the network admin —
 * Core's site screen offers no action on it, and neither does this
 * window unless the viewer manages network plugins.
 *
 * @param array $row Core REST plugin row.
 * @return array{activate:bool,deactivate:bool,delete:bool}
 */
function openstation_plugins_window_field_can_manage( $row ) {
	static $caps = null;
	if ( null === $caps || ! isset( $caps['user'] ) || get_current_user_id() !== $caps['user'] ) {
		$caps = array(
			'user'     => get_current_user_id(),
			'activate' => current_user_can( 'activate_plugins' ),
			// Never on multisite: plugin files are network-wide, and
			// Core's site screens offer no delete — see the note in
			// `openstation_plugins_window_caps()`.
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
		// Active plugins can only be deleted after deactivation.
		'delete'     => $caps['delete'] && 'inactive' === $status,
	);
}

/**
 * `openstation_size_kb` callback. Every folder's size lives in ONE
 * transient (`{ file => kb }`, 6h) read once per request, so a 50-row
 * table costs one option read rather than fifty; a folder missing
 * from the map is measured and the map written back on shutdown.
 * Returns `null` when the folder can't be read.
 *
 * @param array $row Core REST plugin row.
 * @return int|null Size in kilobytes, or null on failure.
 */
function openstation_plugins_window_field_size_kb( $row ) {
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return null;
	}

	$root = WP_PLUGIN_DIR . '/' . dirname( $plugin_file );
	if ( '.' === dirname( $plugin_file ) || ! is_dir( $root ) ) {
		// Single-file plugins (e.g. hello.php at the root of plugins/).
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

/**
 * The size map, read from its transient once per request; with a file
 * and a size, record that entry and schedule the write-back.
 *
 * @param string   $plugin_file Optional. A plugin file to record.
 * @param int|null $kb          Optional. Its size in kilobytes.
 * @return array<string,int> The map as of now.
 */
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

/**
 * Drop the size map after an install, update or delete changed a
 * folder — the next paint measures it again.
 *
 * @return void
 */
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

/**
 * Recursively sum file sizes under `$dir`, returning kilobytes.
 *
 * Caps total iteration to 5,000 entries so a pathological symlink
 * loop (or an enormous plugin folder full of vendor cruft) can't
 * stall a REST response. When the cap trips we return whatever we
 * counted so far — a slight under-report is better than a hung
 * request.
 *
 * @param string $dir Absolute filesystem path.
 * @return int Kilobytes (rounded).
 */
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
		$entries = @scandir( $current ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- best-effort, errors fall back to null.
		if ( ! is_array( $entries ) ) {
			continue;
		}
		foreach ( $entries as $entry ) {
			if ( '.' === $entry || '..' === $entry ) {
				continue;
			}
			$path = $current . '/' . $entry;
			if ( is_link( $path ) ) {
				// Skip symlinks: they could escape the plugin folder
				// or recurse infinitely. The classic admin's plugin
				// list ignores symlink contents for the same reason.
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
