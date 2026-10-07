<?php

namespace Automattic\Jetpack;

class Modules {

	public static $stats_active = true;

	public function is_active( $module ) {
		return 'stats' === $module && self::$stats_active;
	}
}
