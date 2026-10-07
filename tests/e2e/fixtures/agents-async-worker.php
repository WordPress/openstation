<?php

defined( 'ABSPATH' ) || exit;
add_filter( 'openstation_agents_enabled', '__return_true' );
add_filter(
	'openstation_agent_runner_generate',
	static function ( $result, $history ) {
		foreach ( $history as $row ) {
			if ( isset( $row['text'] ) && '__openstation_async_http_smoke__' === $row['text'] ) {

				sleep( 35 );
				return array( 'text' => 'Slow HTTP job completed.', 'function_calls' => array(), 'message' => null );
			}
		}
		return new WP_Error( 'test_only', 'Only the smoke-test message is allowed.' );
	},
	10,
	2
);
