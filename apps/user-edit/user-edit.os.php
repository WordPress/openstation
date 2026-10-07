<?php

namespace OpenStation\Apps\UserEdit;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/account.php';
require_once __DIR__ . '/parts/insights.php';

require_once dirname( __DIR__ ) . '/users/parts/permissions.php';
require_once dirname( __DIR__ ) . '/users/parts/color-schemes.php';
require_once dirname( __DIR__ ) . '/users/parts/fields.php';
require_once dirname( __DIR__ ) . '/users/parts/facts.php';
require_once dirname( __DIR__ ) . '/users/parts/profile-script.php';

function retarget( State $state, Os $os ) {
	$user_id = (int) $os->param( 'userId', 0 );
	$state->set( 'userId', $user_id > 0 ? $user_id : (int) get_current_user_id() );
}

return App::define( 'desktop-mode-user-edit' )
	->title( __( 'Edit user', 'desktop-mode' ) )
	->icon( 'dashicons-admin-users' )
	->size( 1100, 760 )
	->min_size( 720, 520 )
	->placement( 'none' )

	->style( dirname( __DIR__ ) . '/users/users.css' )
	->can(
		static function () {
			return openstation_user_edit_window_user_can_register();
		}
	)

	->config( 'openstation_users_profile_facts' )
	->state( array( 'userId' => 0 ) )
	->mount( __NAMESPACE__ . '\retarget' )

	->action( 'reopen', __NAMESPACE__ . '\retarget' )
	->data(
		static function ( State $state ) {
			return array( 'userId' => (int) $state->get( 'userId' ) );
		}
	);
