<?php
/**
 * OpenStation App Framework — Env contract.
 *
 * Facts about the host the app is running in: configuration
 * constants, where content lives, which platform this is. The one
 * place a window learns anything about WordPress without naming it.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

interface Env {

	/**
	 * A host configuration constant (`WP_DEBUG`, `SAVEQUERIES`, …).
	 *
	 * @param string $name     Constant name.
	 * @param mixed  $fallback Returned when the constant is undefined.
	 * @return mixed
	 */
	public function constant( $name, $fallback = null );

	/**
	 * Absolute path of the writable content directory.
	 *
	 * @return string
	 */
	public function content_dir();

	/**
	 * The host platform, as `array( 'name' => 'WordPress', 'version' => '6.8' )`.
	 *
	 * @return array{name:string,version:string}
	 */
	public function platform();

	/**
	 * Deployment environment: `production`, `staging`, `development`, `local`.
	 *
	 * @return string
	 */
	public function environment_type();

	/**
	 * Whether this install is one site among many sharing the same
	 * files (a WordPress network). Apps raise their bar accordingly.
	 *
	 * @return bool
	 */
	public function is_network();

	/**
	 * Format a Unix timestamp in the host's timezone and locale.
	 *
	 * @param int    $timestamp Unix seconds.
	 * @param string $format    PHP date format.
	 * @return string
	 */
	public function format_datetime( $timestamp, $format = 'Y-m-d H:i:s' );
}
