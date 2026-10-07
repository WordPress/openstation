<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Settings as SettingsContract;

defined( 'ABSPATH' ) || exit;

final class Settings implements SettingsContract {

	public function user_preference( $key, $fallback = null ) {
		if ( ! function_exists( 'openstation_get_os_settings' ) ) {
			return $fallback;
		}
		$settings = openstation_get_os_settings( get_current_user_id() );
		return is_array( $settings ) && array_key_exists( $key, $settings ) ? $settings[ $key ] : $fallback;
	}

	public function site_option( $key, $fallback = null ) {
		return get_option( (string) $key, $fallback );
	}
}
