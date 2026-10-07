<?php

namespace OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class View {

	public static function capture( callable $view, State $state, Os $os ) {
		ob_start();
		try {
			$returned = $view( $state, $os );
		} catch ( \Throwable $e ) {
			ob_end_clean();
			throw $e;
		}
		$echoed = (string) ob_get_clean();
		return $echoed . ( is_string( $returned ) ? $returned : '' );
	}
}
