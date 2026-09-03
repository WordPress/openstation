<?php
/**
 * Pages — the native Pages window, as an OpenStation app.
 *
 * Claims the FROZEN window id `desktop-mode-pages` (see AGENTS.md).
 * The Posts app's twin over `/wp/v2/pages`: hierarchical (a Parent
 * column, `menu_order` by default), a Template / Slug / Comments
 * column set, front-page and posts-page badges, and no taxonomy tabs.
 * The list machinery is shared with the Posts app — this entry
 * requires `apps/posts/parts/query.php` and `pages.os.ts` composes the
 * same client parts (sanctioned cross-app reuse, noted in both).
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard must land inside.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Pages;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/query.php';
require_once dirname( __DIR__ ) . '/posts/parts/query.php';

return App::define( 'desktop-mode-pages' )
	->title( __( 'Pages', 'desktop-mode' ) )
	->icon( 'dashicons-admin-page' )
	->size( 1100, 720 )
	->min_size( 720, 480 )
	// The Pages dock tile is WordPress's own; the shell's URL remap
	// routes `edit.php?post_type=page` here under `nativePagesEnabled`.
	->placement( 'none' )
	->can(
		static function () {
			return openstation_pages_window_user_can_register();
		}
	)
	->config(
		static function () {
			return openstation_posts_app_config( 'pages' );
		}
	)
	->state( openstation_posts_app_state( 'menu_order', 'asc' ) )
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
			openstation_posts_app_sort( $state, $args );
		}
	)
	->action(
		'trash',
		static function ( State $state, Os $os, array $args ) {
			openstation_posts_app_trash( $os, $args, 'page' );
		}
	)
	->watch( 'page' )
	->data(
		static function ( State $state ) {
			return openstation_posts_app_data( 'wp/v2/pages', openstation_pages_window_default_query_args(), $state );
		}
	);
