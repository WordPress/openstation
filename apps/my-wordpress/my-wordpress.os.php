<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/woocommerce.php';
require_once __DIR__ . '/parts/sections.php';
require_once __DIR__ . '/parts/lists.php';
require_once __DIR__ . '/parts/dossiers.php';
require_once __DIR__ . '/parts/actions.php';
require_once __DIR__ . '/parts/agents.php';
require_once __DIR__ . '/parts/payload.php';

return App::define( 'my-wordpress' )

	->title(
		function_exists( 'openstation_my_wordpress_app_title' )
			? openstation_my_wordpress_app_title()
			: __( 'WP Explorer', 'desktop-mode' )
	)
	->icon(
		function_exists( 'openstation_my_wordpress_icon_svg' )
			? openstation_my_wordpress_icon_svg()
			: ICON
	)
	->size( 960, 640 )
	->min_size( 640, 420 )
	->placement( 'none' )
	->desktop_icon(
		array(
			'position' => -1,
			'pinned'   => true,
		)
	)
	->capabilities( 'edit_posts' )
	->watch( '*' )
	->state(
		array(
			'group'       => '',
			'section'     => '',
			'item'        => 0,
			'into'        => 0,
			'relation'    => '',

			'footprint'   => 0,
			'fpName'      => '',
			'query'       => '',
			'page'        => 1,
			'sort'        => '',
			'selected'    => array(),

			'view'        => 'icons',

			'pane'        => 'define',
			'casting'     => false,
			'wstep'       => 0,
			'cast'        => null,
			'agentNotice' => '',
			'briefError'  => '',
		)
	)
	->title_bar_button(
		'refresh',
		array(
			'label'  => __( 'Refresh', 'desktop-mode' ),
			'icon'   => 'reload',
			'action' => 'refresh',
		)
	)

	->mount( __NAMESPACE__ . '\mount' )

	->action( 'reopen', __NAMESPACE__ . '\reopen_action' )

	->action( 'go', __NAMESPACE__ . '\go_action' )
	->action( 'back', __NAMESPACE__ . '\back_action' )
	->action( 'open', __NAMESPACE__ . '\open_action' )
	->action( 'into', __NAMESPACE__ . '\into_action' )
	->action( 'relation', __NAMESPACE__ . '\relation_action' )
	->action( 'footprint', __NAMESPACE__ . '\footprint_action' )
	->action( 'sub-open-post', __NAMESPACE__ . '\sub_open_post_action' )

	->action(
		'search',
		static function ( State $state ) {
			$state->set( 'page', 1 )->set( 'item', 0 )->reset( 'selected' );
		}
	)
	->action(
		'more',
		static function ( State $state ) {
			$state->set( 'page', (int) $state->get( 'page' ) + 1 );
		}
	)
	->action(
		'sort',
		static function ( State $state ) {
			$state->set( 'page', 1 )->reset( 'selected' );
		}
	)

	->action( 'view', __NAMESPACE__ . '\view_action' )
	->action( 'set-columns', __NAMESPACE__ . '\set_columns_action' )

	->action( 'edit', __NAMESPACE__ . '\edit_action' )
	->action( 'add-user', __NAMESPACE__ . '\add_user_action' )
	->action( 'trash', __NAMESPACE__ . '\trash_action' )
	->action( 'sub-open', __NAMESPACE__ . '\sub_open_action' )
	->action( 'quick-edit', __NAMESPACE__ . '\quick_edit_action' )
	->action( 'bulk-trash', __NAMESPACE__ . '\bulk_trash_action' )

	->action( 'agent-draft', __NAMESPACE__ . '\agent_draft_action' )
	->action( 'agent-create', __NAMESPACE__ . '\agent_create_action' )
	->action( 'agent-update', __NAMESPACE__ . '\agent_update_action' )
	->action( 'agent-delete', __NAMESPACE__ . '\agent_delete_action' )

	->data( __NAMESPACE__ . '\payload' );
