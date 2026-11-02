<?php
/**
 * Plugins app — the links a plugin adds to its own row.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. A plugin's "Settings" link (and its "Docs",
 * "Support", "Go Pro") is not part of the plugin resource: Core builds
 * it on `plugins.php` from the `plugin_action_links` filters. A plugin
 * that hides its settings page from the admin menu leaves that link as
 * the only way in, so the window has to offer it too.
 *
 *   wp_ajax_openstation_plugins_action_links — `{ plugin => [ { key, label, url, admin } ] }`
 *
 * On admin-ajax, not a REST field: many plugins only add the filter
 * behind `is_admin()`, which is false on a REST request (and a
 * dispatch is one), so a field would miss exactly those.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Keys of the row actions Core adds itself. The window has its own
 * verbs for these, so they are dropped from what the filters return,
 * along with whatever a plugin rewrote them into (a deactivation
 * survey replacing the Deactivate link, for one).
 */
const OPENSTATION_PLUGINS_CORE_ACTION_KEYS = array( 'activate', 'deactivate', 'delete', 'network_active', 'network_only', 'resume', 'edit' );

/**
 * The row actions Core starts a plugin's row with on `plugins.php`,
 * as `WP_Plugins_List_Table::single_row()` builds them. Some plugins
 * only add their link when `deactivate` is there (an active row), so
 * the filters get the same starting list Core gives them.
 *
 * @param string $plugin_file Plugin file, relative to the plugins directory.
 * @return array<string,string> Action key => link HTML.
 */
function openstation_plugins_window_core_row_actions( $plugin_file ) {
	$url = static function ( $action ) use ( $plugin_file ) {
		return wp_nonce_url(
			admin_url( 'plugins.php?action=' . $action . '&plugin=' . rawurlencode( $plugin_file ) ),
			$action . '-plugin_' . $plugin_file
		);
	};

	if ( is_multisite() && is_plugin_active_for_network( $plugin_file ) ) {
		return array( 'network_active' => __( 'Network Active', 'desktop-mode' ) );
	}
	if ( is_plugin_active( $plugin_file ) ) {
		return array(
			'deactivate' => sprintf( '<a href="%s">%s</a>', esc_url( $url( 'deactivate' ) ), esc_html__( 'Deactivate', 'desktop-mode' ) ),
		);
	}
	return array(
		'activate' => sprintf( '<a href="%s">%s</a>', esc_url( $url( 'activate' ) ), esc_html__( 'Activate', 'desktop-mode' ) ),
		'delete'   => sprintf( '<a href="%s">%s</a>', esc_url( $url( 'delete-selected' ) ), esc_html__( 'Delete', 'desktop-mode' ) ),
	);
}

/**
 * Resolve a row link's `href` the way the browser would on `plugins.php`.
 *
 * Relative hrefs (`options-general.php?page=x`) resolve against
 * wp-admin, root-relative ones against the site's origin. Anything that
 * is not http(s) — `#`, `javascript:`, a `mailto:` — is not a page the
 * window can open, and comes back empty.
 *
 * @param string $href Raw `href` attribute value.
 * @return string Absolute URL, or '' when there is nothing to open.
 */
function openstation_plugins_window_resolve_link_url( $href ) {
	$href = trim( html_entity_decode( (string) $href, ENT_QUOTES, 'UTF-8' ) );
	if ( '' === $href || '#' === $href[0] ) {
		return '';
	}
	if ( 0 === strpos( $href, '//' ) ) {
		$href = set_url_scheme( $href );
	}
	$parts = wp_parse_url( $href );
	if ( false === $parts ) {
		return '';
	}
	if ( isset( $parts['scheme'] ) ) {
		return in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ? $href : '';
	}
	if ( '/' === $href[0] ) {
		$home = wp_parse_url( home_url() );
		if ( empty( $home['scheme'] ) || empty( $home['host'] ) ) {
			return '';
		}
		return $home['scheme'] . '://' . $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' ) . $href;
	}
	return admin_url( $href );
}

/**
 * The links a plugin's row offers on `plugins.php`, minus Core's own.
 *
 * Runs the same two filters `WP_Plugins_List_Table::single_row()` runs
 * on a site's Plugins screen, in the same order and with the same
 * arguments, then keeps each entry that is a link to an http(s) page.
 * `admin` says whether the page is in this site's wp-admin, which the
 * window opens as a window rather than a browser tab.
 *
 * @param string $plugin_file Plugin file, relative to the plugins directory.
 * @param array  $plugin_data Header data, as `get_plugins()` returns it.
 * @return array<int,array{key:string,label:string,url:string,admin:bool}>
 */
function openstation_plugins_window_action_links( $plugin_file, $plugin_data ) {
	$actions = openstation_plugins_window_core_row_actions( $plugin_file );
	// phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WordPress.NamingConventions.PrefixAllGlobals.DynamicHooknameFound -- Core's own row-action filters, replayed for the window as plugins.php runs them.
	$actions = apply_filters( 'plugin_action_links', $actions, $plugin_file, $plugin_data, 'all' );
	$actions = apply_filters( "plugin_action_links_{$plugin_file}", $actions, $plugin_file, $plugin_data, 'all' );
	// phpcs:enable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WordPress.NamingConventions.PrefixAllGlobals.DynamicHooknameFound

	if ( ! is_array( $actions ) ) {
		return array();
	}

	$admin = admin_url();
	$links = array();
	foreach ( $actions as $key => $action ) {
		if ( ! is_string( $action ) || in_array( $key, OPENSTATION_PLUGINS_CORE_ACTION_KEYS, true ) ) {
			continue;
		}
		if ( ! preg_match( '/<a\s[^>]*\bhref\s*=\s*(["\'])(.*?)\1/is', $action, $match ) ) {
			continue;
		}
		$url   = openstation_plugins_window_resolve_link_url( $match[2] );
		$label = trim( html_entity_decode( wp_strip_all_tags( $action ), ENT_QUOTES, 'UTF-8' ) );
		if ( '' === $url || '' === $label ) {
			continue;
		}
		$links[] = array(
			'key'   => (string) $key,
			'label' => $label,
			'url'   => esc_url_raw( $url ),
			'admin' => 0 === strpos( $url, $admin ),
		);
	}
	return $links;
}

/**
 * `wp_ajax_openstation_plugins_action_links` — every installed plugin's
 * row links, keyed the way `/wp/v2/plugins` keys its rows (the plugin
 * file without `.php`). Plugins with no links of their own are absent.
 *
 * Gated like the Plugins screen itself, on `activate_plugins`.
 */
function openstation_plugins_window_ajax_action_links() {
	$guard = openstation_plugins_window_ajax_guard( 'activate_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
	}

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	// OpenStation's own row link opens or turns on the shell. It already
	// stays off chromeless pages, and this request is asked from inside
	// the shell too, where "Open OpenStation" would open it in a window
	// of itself.
	remove_filter( 'plugin_action_links_' . plugin_basename( OPENSTATION_FILE ), 'openstation_plugin_row_action_links' );

	$map = array();
	foreach ( get_plugins() as $plugin_file => $plugin_data ) {
		$links = openstation_plugins_window_action_links( $plugin_file, $plugin_data );
		if ( array() !== $links ) {
			$map[ preg_replace( '/\.php$/', '', $plugin_file ) ] = $links;
		}
	}

	wp_send_json_success( (object) $map );
}
add_action( 'wp_ajax_openstation_plugins_action_links', 'openstation_plugins_window_ajax_action_links' );
