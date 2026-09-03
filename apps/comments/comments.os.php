<?php
/**
 * Comments — the moderation window, as an OpenStation app.
 *
 * The App Framework rebuild of the native Comments window; it claims
 * the frozen id `desktop-mode-comments` (see AGENTS.md), so the URL
 * remap, the dock tile, the saved sessions and every window-links
 * identity keep working unchanged. A two-pane conversation view: the
 * rail of conversations on the left, the nested thread with its
 * actions and composer on the right, painted by the client view
 * (`comments.os.ts`) from the `data()` below.
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard below must land
 * inside that window.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Comments;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/spam-score.php';
require_once __DIR__ . '/parts/ai-moderation.php';
require_once __DIR__ . '/parts/fields.php';
require_once __DIR__ . '/parts/rest.php';
require_once __DIR__ . '/parts/app.php';

return App::define( 'desktop-mode-comments' )
	->title( __( 'Comments', 'desktop-mode' ) )
	->icon( 'dashicons-admin-comments' )
	->size( 1180, 760 )
	->min_size( 760, 480 )
	// No dock or wallpaper tile from this registration: the Comments
	// dock tile lives in WordPress's `$menu`, and the shell's URL remap
	// routes its click here when the opt-in is on.
	->placement( 'none' )
	->can(
		static function () {
			return \openstation_comments_window_user_can_register();
		}
	)
	// Static facts the view reads on every paint — shipped once with
	// the window config, never riding a response. Resolved when the
	// manifest is built, for the acting user. UI-side gating is
	// polish: every action re-checks the cap server-side.
	->config(
		static function () {
			return array(
				'currentUserId'   => (int) get_current_user_id(),
				'canModerate'     => current_user_can( 'moderate_comments' ),
				'canEditComments' => current_user_can( 'edit_posts' ),
				'replyEditor'     => (string) apply_filters(
					/**
					 * Filter the reply editor implementation the app mounts.
					 *
					 * - `'rich'`      — built-in editor (default).
					 * - `'gutenberg'` — full @wordpress/block-editor (follow-up surface).
					 * - `'plain'`     — plain textarea, no toolbar.
					 *
					 * @param string $editor    Editor flavor slug.
					 * @param int    $viewer_id Current user id.
					 */
					'openstation_comments_window_reply_editor',
					'rich',
					(int) get_current_user_id()
				),
				// Cap-gated mirror of what the REST endpoint returns, so the
				// Preferences UI can branch on it without a separate fetch.
				'aiModeration'    => array(
					'enabled'            => \openstation_comments_ai_is_enabled(),
					'providerConfigured' => \openstation_comments_ai_provider_configured(),
					'canManage'          => current_user_can( 'manage_options' ),
				),
			);
		}
	)
	->state(
		array(
			'tab'      => 'pending',
			'search'   => '',
			'page'     => 1,
			'perPage'  => PER_PAGE,
			// The `edit-comments.php?p=<id>` scope; 0 is every post.
			'post'     => 0,
			// The conversation on screen; 0 is the placeholder.
			'selected' => 0,
			// Bumped by every mutation so the client's page accumulation
			// starts clean, the way the old rail reloaded page 1.
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
	// A comment changing anywhere on the desktop repaints the window.
	->watch( 'comment' )
	->data( __NAMESPACE__ . '\data' );
