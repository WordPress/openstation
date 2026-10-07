<?php

namespace OpenStation\Apps\Comments;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/spam-score.php';
require_once __DIR__ . '/parts/fields.php';
require_once __DIR__ . '/parts/rest.php';
require_once __DIR__ . '/parts/app.php';

return App::define( 'desktop-mode-comments' )
	->title( __( 'Comments', 'desktop-mode' ) )
	->icon( 'dashicons-admin-comments' )
	->size( 1180, 760 )
	->min_size( 760, 480 )

	->placement( 'none' )
	->can(
		static function () {
			return \openstation_comments_window_user_can_register();
		}
	)

	->config(
		static function () {
			return array(
				'currentUserId'   => (int) get_current_user_id(),
				'canModerate'     => current_user_can( 'moderate_comments' ),
				'canEditComments' => current_user_can( 'edit_posts' ),
			);
		}
	)
	->state(
		array(
			'tab'      => 'pending',
			'search'   => '',
			'page'     => 1,

			'post'     => 0,

			'selected' => 0,

			'gen'      => 0,
		)
	)
	->mount( __NAMESPACE__ . '\mount' )
	->action( 'reopen', __NAMESPACE__ . '\reopen_action' )
	->action( 'filter', __NAMESPACE__ . '\filter_action' )
	->action( 'page', __NAMESPACE__ . '\page_action' )
	->action( 'select', __NAMESPACE__ . '\select_action' )
	->action( 'moderate', __NAMESPACE__ . '\moderate_action' )
	->action( 'reply', __NAMESPACE__ . '\reply_action' )
	->action( 'edit', __NAMESPACE__ . '\edit_action' )

	->watch( 'comment' )
	->data( __NAMESPACE__ . '\data' );
