<?php
/**
 * My WordPress — the content explorer, as an OpenStation app.
 *
 * The full WP Explorer surface on the App Framework, split the way
 * the framework splits: the PHP half is the window and the truth, the
 * BODY lives in `my-wordpress.os.ts` beside it — a client view where
 * selection, infinite scroll, drag-out, the context menu, media zoom
 * and every repaint are instant. `watch( '*' )` repaints the window
 * whenever any other window changes any content.
 *
 * THIS file is deliberately just the composition: the window's
 * declaration, its state schema, and the wiring of actions to their
 * handlers. The substance lives in focused parts beside it (plain
 * `.php` on purpose — only `*.os.php` files are app entries to the
 * framework loader; see "Splitting a large app" in
 * `docs/app-framework.md`):
 *
 *   parts/sections.php  What the explorer OFFERS — the section
 *                       registry (builtins + discovered CPTs with
 *                       their plugin-group folders + Agents), sorts.
 *   parts/lists.php     What a section CONTAINS — the queries, the
 *                       counts, per-item authorization, the dossier.
 *   parts/dossiers.php  What a post OPENS INTO — relation folders,
 *                       sub-lists, the stats panes, edit choices,
 *                       preview actions.
 *   parts/actions.php   What a dispatch DOES — navigation and the
 *                       content mutations.
 *   parts/agents.php    The Agents section — payload + mutations.
 *   parts/woocommerce.php The WooCommerce surface — the Orders and
 *                       Customers sections, band-ordered queries,
 *                       per-row shop facts. Inert without WooCommerce.
 *   parts/payload.php   The data payload, one function.
 *
 * Plugin surfaces are shared with the original explorer, not forked:
 * CPT discovery honours `openstation_my_wordpress_post_types` /
 * `_post_type_entity` / `_post_type_groups`, the preview-action
 * pipeline consumes the same `openstation_my_wordpress_preview_actions`
 * descriptors and the same `os.my-wordpress.preview-actions` JS
 * filter, and the Agents section runs through the same
 * `openstation_agent_*` store, draft, identity and catalogue
 * functions the `/desktop-mode/v1/agents` routes wrap. This app IS
 * WP Explorer now — the legacy window (`desktop-mode-my-wordpress`)
 * is gone, and the app carries its name, its icon, its pinned
 * launcher slot, and every one of its surfaces (`parts/footprint.ts`
 * holds the last one to move in, the activity footprint).
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
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
	// The app IS WP Explorer now: it wears the original's name, its
	// folder-with-mark art, and its pinned launcher slot. The helpers
	// stay in `includes/my-wordpress/window.php` (that module keeps
	// hosting the detail/footprint surfaces, launcher-less); the
	// guards cover a standalone host where they don't load.
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
			// The activity footprint: whose fills the body (0 = closed),
			// and their name for the breadcrumb before the payload lands.
			'footprint'   => 0,
			'fpName'      => '',
			'query'       => '',
			'page'        => 1,
			'sort'        => '',
			'selected'    => array(),
			// The Agents section. `item` doubles as the selected agent;
			// the rest is the wizard: which detail tab is open, whether
			// the create flow is on and at which station, the agent
			// taking shape in it (an untyped slot — the client rolls
			// its face and its seeds, the server drafts into it and
			// creates from it), and the two message rails the original
			// kept in renderer state.
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
	// `refresh` is the framework's built-in: recompute data(), re-render.
	// Navigation — parts/actions.php.
	->action( 'go', __NAMESPACE__ . '\go_action' )
	->action( 'back', __NAMESPACE__ . '\back_action' )
	->action( 'open', __NAMESPACE__ . '\open_action' )
	->action( 'into', __NAMESPACE__ . '\into_action' )
	->action( 'relation', __NAMESPACE__ . '\relation_action' )
	->action( 'footprint', __NAMESPACE__ . '\footprint_action' )
	->action( 'sub-open-post', __NAMESPACE__ . '\sub_open_post_action' )
	// List controls: the bound values already arrived with the state;
	// these only reposition the query window.
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
	// Content mutations — parts/actions.php.
	->action( 'edit', __NAMESPACE__ . '\edit_action' )
	->action( 'trash', __NAMESPACE__ . '\trash_action' )
	->action( 'sub-open', __NAMESPACE__ . '\sub_open_action' )
	->action( 'quick-edit', __NAMESPACE__ . '\quick_edit_action' )
	->action( 'bulk-trash', __NAMESPACE__ . '\bulk_trash_action' )
	// The Agents section — parts/agents.php.
	->action( 'agent-draft', __NAMESPACE__ . '\agent_draft_action' )
	->action( 'agent-create', __NAMESPACE__ . '\agent_create_action' )
	->action( 'agent-update', __NAMESPACE__ . '\agent_update_action' )
	->action( 'agent-delete', __NAMESPACE__ . '\agent_delete_action' )
	// The data payload — parts/payload.php.
	->data( __NAMESPACE__ . '\payload' );
