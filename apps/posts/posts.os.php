<?php

namespace OpenStation\Apps\Posts;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/query.php';
require_once __DIR__ . '/parts/terms-rest.php';

return App::define( 'desktop-mode-posts' )
	->title( __( 'Posts', 'desktop-mode' ) )
	->icon( 'dashicons-admin-post' )
	->size( 1100, 720 )
	->min_size( 720, 480 )

	->placement( 'none' )

	->can(
		static function () {
			return openstation_posts_window_user_can_register();
		}
	)

	->config(
		static function () {
			return openstation_posts_app_config( 'posts', 'date', 'desc' );
		}
	)
	->state( openstation_posts_app_state( 'date', 'desc' ) )

	->menu(
		'edit.php',
		static function () {
			$tabs = array(
				'posts' => array(
					'label' => __( 'All posts', 'desktop-mode' ),
					'page'  => 'edit.php',
				),
				'new'   => array(
					'label' => __( 'Add Post', 'desktop-mode' ),
					'page'  => 'post-new.php',
				),
			);

			if ( current_user_can( 'manage_categories' ) ) {
				$tabs['categories'] = array(
					'label' => __( 'Categories', 'desktop-mode' ),
					'page'  => 'edit-tags.php?taxonomy=category',
				);
				$tabs['tags']       = array(
					'label' => __( 'Tags', 'desktop-mode' ),
					'page'  => 'edit-tags.php?taxonomy=post_tag',
				);
			}
			return $tabs;
		},
		'openstation_posts_window_user_can_use'
	)
	->action(
		'filter',
		static function ( State $state ) {
			openstation_posts_app_filter( $state );
		}
	)
	->action(
		'page',
		static function ( State $state, Os $os, array $args ) {
			openstation_posts_app_page( $state, $args );
		}
	)
	->action(
		'sort',
		static function ( State $state, Os $os, array $args ) {
			openstation_posts_app_sort( $state, $args, 'date', 'desc' );
		}
	)
	->action(
		'trash',
		static function ( State $state, Os $os, array $args ) {
			openstation_posts_app_trash( $os, $args, 'post' );
		}
	)

	->watch( 'post' )
	->data(
		static function ( State $state ) {
			return openstation_posts_app_data( 'wp/v2/posts', openstation_posts_window_default_query_args(), $state );
		}
	);
