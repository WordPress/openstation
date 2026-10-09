<?php
/**
 * Posts — the native Posts window, as an OpenStation app.
 *
 * Claims the FROZEN window id `desktop-mode-posts` (see AGENTS.md):
 * the `edit.php` remap in the shell, the OS Settings opt-in and every
 * session that saved the window keep working unchanged. The dock tile
 * is WordPress's own Posts entry (`placement none`); the JS-side
 * remap routes its click here under `nativePostsEnabled`.
 *
 * The body is `posts.os.ts`: the toolbar, the `<os-table>` and the
 * pager as a client view, plus the Categories mind map and the Tags
 * cloud on their tabs. The list itself is the same `/wp/v2/posts`
 * request the legacy bundle fetched, run in-process by `data()`
 * (`parts/query.php`); the taxonomy REST surface is `parts/terms-rest.php`.
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard must land inside.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Posts;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
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
	// No dock or wallpaper tile from this registration: the Posts dock
	// tile lives in WordPress's `$menu`, and the shell's URL remap
	// routes it here. A separate tile would be a duplicate entry point.
	->placement( 'none' )
	// Cap-only gate (`edit_posts`, filterable) so flipping the opt-in
	// mid-session never needs an F5 — the toggle is a runtime check on
	// the JS-side remap.
	->can(
		static function () {
			return openstation_posts_window_user_can_register();
		}
	)
	// A closure: resolved when the manifest is built, for the acting
	// user — not once when this file loads.
	->config(
		static function () {
			return openstation_posts_app_config( 'posts', 'date', 'desc' );
		}
	)
	->state( openstation_posts_app_state( 'date', 'desc' ) )
	// The Posts menu, while this window answers for it: the dock's
	// submenu becomes these tabs and a row opens the window on its
	// own one. The runtime lands the window on it; the client view
	// renders the strip from the same list.
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
			// The taxonomy tabs are the taxonomy screens, so they
			// answer to the same capability those screens do.
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
	// A post trashed, restored or edited anywhere on the desktop
	// repaints the list — the legacy bundle's `os.post.changed`
	// subscription.
	->watch( 'post' )
	->data(
		static function ( State $state ) {
			return openstation_posts_app_data( 'wp/v2/posts', openstation_posts_window_default_query_args(), $state );
		}
	);
