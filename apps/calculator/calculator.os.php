<?php

namespace OpenStation\Apps\Calculator;

use OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

return App::define( 'openstation-calculator' )
	->title( __( 'Calculator', 'desktop-mode' ) )
	->icon( 'dashicons-calculator' )
	->admin( 'any' )
	->size( 360, 520 )
	->min_size( 280, 420 )
	->capabilities( 'read' )
	->desktop_icon( array( 'position' => 26 ) )
	->autofocus( '.os-calculator' )
	->state(
		array(
			'display'      => '0',
			'accumulator'  => '',
			'operator'     => '',
			'fresh'        => true,
			'lastOperator' => '',
			'lastOperand'  => '',
			'expression'   => '',
			'error'        => false,
		)
	)
	->data( static fn() => array() )
	->prefetch();
