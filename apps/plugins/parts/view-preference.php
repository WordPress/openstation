<?php

namespace OpenStation\Apps\Plugins;

use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function mount_plugins( State $state, Os $os ) {
	$view = $os->stored( 'installed-view', 'cards' );
	$state->set( 'installedView', in_array( $view, array( 'cards', 'table' ), true ) ? $view : 'cards' );
	apply_tab( $state, $os );
}

function save_installed_view( State $state, Os $os, array $args ) {
	$view = $args['view'] ?? '';
	if ( ! in_array( $view, array( 'cards', 'table' ), true ) ) {
		throw new \InvalidArgumentException( esc_html__( 'Choose Cards or Table.', 'desktop-mode' ) );
	}
	$os->store( 'installed-view', $view );
	$state->set( 'installedView', $view );
}
