<?php

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Settings as SettingsContract;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Settings implements SettingsContract {

	private $preferences;

	private $options;

	public function __construct( array $preferences = array(), array $options = array() ) {
		$this->preferences = $preferences;
		$this->options     = $options;
	}

	public function user_preference( $key, $fallback = null ) {
		return array_key_exists( $key, $this->preferences ) ? $this->preferences[ $key ] : $fallback;
	}

	public function site_option( $key, $fallback = null ) {
		return array_key_exists( $key, $this->options ) ? $this->options[ $key ] : $fallback;
	}
}
