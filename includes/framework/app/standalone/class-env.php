<?php

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Env as EnvContract;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Env implements EnvContract {

	private $content_dir;

	private $environment_type;

	public function __construct( $content_dir = '', $environment_type = 'production' ) {
		$this->content_dir      = '' !== $content_dir ? rtrim( (string) $content_dir, '/\\' ) : sys_get_temp_dir();
		$this->environment_type = (string) $environment_type;
	}

	public function constant( $name, $fallback = null ) {
		return defined( $name ) ? constant( $name ) : $fallback;
	}

	public function content_dir() {
		return $this->content_dir;
	}

	public function platform() {
		return array(
			'name'    => 'PHP',
			'version' => PHP_VERSION,
		);
	}

	public function environment_type() {
		return $this->environment_type;
	}

	public function is_network() {
		return false;
	}

	public function format_datetime( $timestamp, $format = 'Y-m-d H:i:s' ) {

		return date( (string) $format, (int) $timestamp );
	}
}
