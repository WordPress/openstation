<?php
/**
 * Remove Background — settings.
 *
 * One option (`desktop_mode_remove_background`) holding the backend
 * choice and its credentials, surfaced as a native Settings API
 * section on Settings → Media (no custom admin page).
 *
 * @package DesktopModeRemoveBackground
 */

defined( 'ABSPATH' ) || exit;

/** Option key for the settings bundle. */
const DESKTOP_MODE_REMOVE_BG_OPTION = 'desktop_mode_remove_background';

/**
 * Settings with defaults filled in.
 *
 * @return array{backend:string, removebg_api_key:string, rembg_endpoint:string}
 */
function desktop_mode_remove_bg_get_settings() {
	$defaults = array(
		'backend'          => 'removebg',
		'removebg_api_key' => '',
		'rembg_endpoint'   => '',
	);
	$raw = get_option( DESKTOP_MODE_REMOVE_BG_OPTION, array() );
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}
	return array_merge( $defaults, array_intersect_key( $raw, $defaults ) );
}

/**
 * Sanitize the option payload.
 *
 * @param mixed $raw Incoming value.
 * @return array
 */
function desktop_mode_remove_bg_sanitize_settings( $raw ) {
	$clean = desktop_mode_remove_bg_get_settings();
	if ( ! is_array( $raw ) ) {
		return $clean;
	}
	if ( isset( $raw['backend'] ) ) {
		$backend = sanitize_key( (string) $raw['backend'] );
		if ( array_key_exists( $backend, desktop_mode_remove_bg_backends() ) ) {
			$clean['backend'] = $backend;
		}
	}
	if ( isset( $raw['removebg_api_key'] ) ) {
		$clean['removebg_api_key'] = trim( sanitize_text_field( (string) $raw['removebg_api_key'] ) );
	}
	if ( isset( $raw['rembg_endpoint'] ) ) {
		$clean['rembg_endpoint'] = esc_url_raw( trim( (string) $raw['rembg_endpoint'] ) );
	}
	return $clean;
}

/**
 * Register the section + fields on Settings → Media.
 *
 * @return void
 */
function desktop_mode_remove_bg_register_settings() {
	register_setting(
		'media',
		DESKTOP_MODE_REMOVE_BG_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'desktop_mode_remove_bg_sanitize_settings',
		)
	);

	add_settings_section(
		'desktop-mode-remove-background',
		__( 'Background removal', 'desktop-mode-remove-background' ),
		static function () {
			echo '<p>' . esc_html__( 'Backend used by the media-tools/remove-background ability (Desktop Mode agents and other Abilities API consumers).', 'desktop-mode-remove-background' ) . '</p>';
		},
		'media'
	);

	add_settings_field(
		'desktop_mode_remove_bg_backend',
		__( 'Backend', 'desktop-mode-remove-background' ),
		static function () {
			$settings = desktop_mode_remove_bg_get_settings();
			$labels   = array(
				'removebg' => __( 'remove.bg API (key required)', 'desktop-mode-remove-background' ),
				'rembg'    => __( 'Self-hosted rembg server (endpoint URL required)', 'desktop-mode-remove-background' ),
				'ai'       => __( 'WordPress AI Client — generative editing, experimental', 'desktop-mode-remove-background' ),
			);
			echo '<select name="' . esc_attr( DESKTOP_MODE_REMOVE_BG_OPTION ) . '[backend]">';
			foreach ( desktop_mode_remove_bg_backends() as $slug => $unused ) {
				printf(
					'<option value="%s"%s>%s</option>',
					esc_attr( $slug ),
					selected( $settings['backend'], $slug, false ),
					esc_html( isset( $labels[ $slug ] ) ? $labels[ $slug ] : $slug )
				);
			}
			echo '</select>';
		},
		'media',
		'desktop-mode-remove-background'
	);

	add_settings_field(
		'desktop_mode_remove_bg_api_key',
		__( 'remove.bg API key', 'desktop-mode-remove-background' ),
		static function () {
			$settings = desktop_mode_remove_bg_get_settings();
			printf(
				'<input type="password" class="regular-text" name="%s[removebg_api_key]" value="%s" autocomplete="off" />',
				esc_attr( DESKTOP_MODE_REMOVE_BG_OPTION ),
				esc_attr( $settings['removebg_api_key'] )
			);
		},
		'media',
		'desktop-mode-remove-background'
	);

	add_settings_field(
		'desktop_mode_remove_bg_endpoint',
		__( 'rembg endpoint URL', 'desktop-mode-remove-background' ),
		static function () {
			$settings = desktop_mode_remove_bg_get_settings();
			printf(
				'<input type="url" class="regular-text" name="%s[rembg_endpoint]" value="%s" placeholder="http://127.0.0.1:7000/api/remove" />',
				esc_attr( DESKTOP_MODE_REMOVE_BG_OPTION ),
				esc_attr( $settings['rembg_endpoint'] )
			);
		},
		'media',
		'desktop-mode-remove-background'
	);
}
add_action( 'admin_init', 'desktop_mode_remove_bg_register_settings' );
