<?php

namespace OpenStation\Apps\Calculator;

use OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

return App::define( 'openstation-calculator' )
	->title( __( 'Calculator', 'desktop-mode' ) )
	->icon( 'dashicons-calculator' )
	->size( 360, 580 )
	->min_size( 280, 500 )
	->placement( 'dock' )
	->admin( 'any' )
	->autofocus( '.os-calculator' )
	->desktop_icon( array( 'position' => 25 ) )
	->capabilities( 'read' )
	->state(
		array(
			'display'        => '0',
			'accumulator'    => '',
			'operator'       => '',
			'fresh'          => true,
			'repeatOperator' => '',
			'repeatOperand'  => '',
			'expression'     => '',
			'error'          => false,
		)
	)
	->data(
		static function () {
			return array();
		}
	)
	->prefetch();
