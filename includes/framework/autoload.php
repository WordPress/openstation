<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
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

require_once OPENSTATION_FRAMEWORK_DIR . '/app/html.php';
