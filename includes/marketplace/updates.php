<?php
/**
 * Desktop Mode — Extensions marketplace: native WP update integration.
 *
 * Injects "update available" rows into WordPress's standard
 * `site_transient_update_plugins` so installed marketplace extensions
 * surface in:
 *
 *   - Dashboard → Updates
 *   - Plugins screen ("update now" inline)
 *   - admin-bar Updates badge
 *   - WP-CLI `wp plugin update`
 *
 * Without this, users would only see updates inside the Desktop Mode
 * settings tab — and miss them when working in classic WP admin.
 *
 * Update detection runs whenever WP refreshes the transient (every
 * ~12h, or via the manual "Check again" link). The marketplace
 * manifest is cached separately on a 15-min transient, so this filter
 * is cheap on the hot path.
 *
 * @since 0.6.0
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Filter callback: append marketplace updates to the standard
 * update_plugins transient.
 *
 * @since 0.6.0
 *
 * @param object|false $value Existing transient value.
 * @return object|false
 */
function desktop_mode_marketplace_inject_updates( $value ) {
	if ( ! is_object( $value ) ) {
		return $value;
	}
	if ( ! isset( $value->response ) || ! is_array( $value->response ) ) {
		$value->response = array();
	}
	if ( ! isset( $value->no_update ) || ! is_array( $value->no_update ) ) {
		$value->no_update = array();
	}

	$merged = desktop_mode_marketplace_get_extensions();
	if ( is_wp_error( $merged ) ) {
		// Don't break the global update check if our manifest is down.
		return $value;
	}

	foreach ( $merged['extensions'] as $entry ) {
		if ( empty( $entry['installed'] ) || empty( $entry['plugin_file'] ) ) {
			continue;
		}
		$plugin_file = (string) $entry['plugin_file'];
		$slug = (string) $entry['slug'];
		$new_version = isset( $entry['version'] ) ? (string) $entry['version'] : '';
		$package = isset( $entry['download_url'] ) ? (string) $entry['download_url'] : '';

		// Only surface entries we have a real download URL for.
		if ( '' === $package || ! desktop_mode_marketplace_is_allowed_url( $package ) ) {
			continue;
		}

		$payload = (object) array(
			'id'           => 'wp-desktop-marketplace/' . $slug,
			'slug'         => $slug,
			'plugin'       => $plugin_file,
			'new_version'  => $new_version,
			'url'          => isset( $entry['homepage'] ) ? (string) $entry['homepage'] : '',
			'package'      => $package,
			'icons'        => array(),
			'banners'      => array(),
			'banners_rtl'  => array(),
			'tested'       => isset( $entry['requires_wp'] ) ? (string) $entry['requires_wp'] : '',
			'requires_php' => isset( $entry['requires_php'] ) ? (string) $entry['requires_php'] : '',
			'compatibility' => new stdClass(),
		);

		if ( ! empty( $entry['needs_update'] ) ) {
			$value->response[ $plugin_file ] = $payload;
			unset( $value->no_update[ $plugin_file ] );
		} else {
			$value->no_update[ $plugin_file ] = $payload;
			unset( $value->response[ $plugin_file ] );
		}
	}

	return $value;
}
add_filter( 'site_transient_update_plugins', 'desktop_mode_marketplace_inject_updates' );

/**
 * Bust the manifest cache after every successful WP plugin upgrade
 * that touches one of our extensions, so the next list fetch reflects
 * the new installed version.
 *
 * @since 0.6.0
 *
 * @param WP_Upgrader $upgrader
 * @param array       $options
 */
function desktop_mode_marketplace_invalidate_after_upgrade( $upgrader, $options ) {
	if ( ! is_array( $options ) || empty( $options['action'] ) ) {
		return;
	}
	if ( 'update' !== $options['action'] && 'install' !== $options['action'] ) {
		return;
	}
	if ( ! isset( $options['type'] ) || 'plugin' !== $options['type'] ) {
		return;
	}
	desktop_mode_marketplace_clear_cache();
}
add_action( 'upgrader_process_complete', 'desktop_mode_marketplace_invalidate_after_upgrade', 10, 2 );
