<?php

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
	->capabilities( 'read' )
	->autofocus( '.os-calculator' )
	->state(
		array(
			'display'     => '0',
			'accumulator' => '',
			'operator'    => '',
			'operand'     => '',
			'repeat'      => '',
			'waiting'     => false,
			'finished'    => false,
			'error'       => false,
			'expression'  => '',
		)
	)
	->data( static fn() => array() )
	->prefetch();
