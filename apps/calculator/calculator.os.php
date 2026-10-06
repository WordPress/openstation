<?php

namespace OpenStation\Apps\Calculator;

use OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

return App::define( 'openstation-calculator' )
	->title( __( 'Calculator', 'desktop-mode' ) )
	->icon( 'dashicons-calculator' )
	->size( 380, 560 )
	->min_size( 280, 440 )
	->admin( 'any' )
	->placement( 'dock' )
	->desktop_icon( array( 'position' => 25 ) )
	->capabilities( 'read' )
	->autofocus( '.os-calculator' )
	->state(
		array(
			'display'         => '0',
			'accumulator'     => '',
			'operator'        => '',
			'replace'         => true,
			'waiting'         => false,
			'lastOperator'    => '',
			'lastOperand'     => '',
			'expression'      => '',
			'error'           => false,
		)
	)
	->data(
		static function () {
			return array();
		}
	)
	->prefetch();
