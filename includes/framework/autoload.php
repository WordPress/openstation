<?php
/**
 * OpenStation App Framework — class autoloader.
 *
 * Maps the `OpenStation\` namespace onto this directory using the
 * WordPress file-naming convention, so a class, an interface and a
 * trait each live where PHPCS expects them:
 *
 *     OpenStation\App                     → class-app.php
 *     OpenStation\App\State               → app/class-state.php
 *     OpenStation\App\Contracts\Auth      → app/contracts/interface-auth.php
 *     OpenStation\App\WordPress\Auth      → app/wordpress/class-auth.php
 *
 * The framework is deliberately host-agnostic: nothing under this
 * directory calls a WordPress function except the adapters in
 * `app/wordpress/` and the procedural glue in `wordpress.php`. A
 * plain PHP host defines `OPENSTATION_STANDALONE` before requiring
 * this file and gets the same framework with the standalone
 * adapters (see `docs/app-framework.md`).
 *
 * @package OpenStation
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

if ( ! defined( 'OPENSTATION_FRAMEWORK_DIR' ) ) {
	define( 'OPENSTATION_FRAMEWORK_DIR', __DIR__ );
}

spl_autoload_register(
	static function ( $class_name ) {
		$prefix = 'OpenStation\\';
		if ( 0 !== strpos( $class_name, $prefix ) ) {
			return;
		}

		$parts = explode( '\\', substr( $class_name, strlen( $prefix ) ) );
		$name  = array_pop( $parts );
		$dir   = OPENSTATION_FRAMEWORK_DIR;
		if ( ! empty( $parts ) ) {
			$dir .= '/' . strtolower( implode( '/', $parts ) );
		}

		// `LogReader` → `log-reader`, matching `class-log-reader.php`.
		$file = strtolower( (string) preg_replace( '/(?<!^)[A-Z]/', '-$0', $name ) );

		foreach ( array( 'class-', 'interface-', 'trait-' ) as $kind ) {
			$path = $dir . '/' . $kind . $file . '.php';
			if ( is_file( $path ) ) {
				require_once $path;
				return;
			}
		}
	}
);

// Template helpers are functions, which no autoloader can find.
require_once OPENSTATION_FRAMEWORK_DIR . '/app/html.php';
