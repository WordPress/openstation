<?php
/**
 * Workspaces — where workspaces are managed.
 *
 * A workspace is MADE on the desk: set the main desk up, press Save
 * under its tile (or `/save-workspace`), and a new desk carries it.
 * This window is everything after that — the name, the glyph and
 * colour, "Hide settings", editing it on its desk, deleting it, and,
 * for someone who may share, its link and the people using it.
 *
 * Two halves, split by where the truth lives:
 *
 *   - The desks and their profiles live in the shell (the session the
 *     window manager holds), so the client view reads and writes them
 *     through `wp.os.workspaces` and never asks PHP.
 *   - Links and recipients live on the server (a share post and a pin
 *     per user — `includes/workspace-shares/`), so they are `data()`
 *     and actions here. Every action re-checks the share capability:
 *     the app is open to everyone who has workspaces, sharing is not.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Workspaces;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/** The window id the shell opens (`src/desktop.ts`, `WORKSPACES_APP_ID`). */
const APP_ID = 'openstation-workspaces';

/**
 * Whether the user may use the app: anyone with OpenStation, except a
 * user pinned to a shared workspace — they have one desk and no say
 * over it.
 *
 * @param Os $os Host.
 * @return bool
 */
function can_use( Os $os ) {
	$user_id = $os->auth->user_id();
	return openstation_is_enabled( $user_id ) && ! openstation_workspace_is_pinned( $user_id );
}

/**
 * Refuses an action to someone who may not share.
 *
 * @param Os $os Host.
 * @return void
 * @throws \RuntimeException When the user may not share.
 */
function require_share( Os $os ) {
	if ( ! openstation_workspace_user_can_share( $os->auth->user_id() ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to share workspaces.', 'desktop-mode' ) );
	}
}

/**
 * The share an action names, or an exception.
 *
 * @param array $args Action args.
 * @return array
 * @throws \RuntimeException When there is no such share.
 */
function share_arg( array $args ) {
	$share = openstation_workspace_share_get( isset( $args['share'] ) ? absint( $args['share'] ) : 0 );
	if ( ! $share ) {
		throw new \RuntimeException( esc_html__( 'That shared workspace no longer exists.', 'desktop-mode' ) );
	}
	return $share;
}

/**
 * Everything the view needs from the server.
 *
 * @param State $state State.
 * @param Os    $os    Host.
 * @return array
 */
function data( State $state, Os $os ) {
	$user_id   = $os->auth->user_id();
	$can_share = openstation_workspace_user_can_share( $user_id );
	$shares    = array();
	if ( $can_share ) {
		// Every share on the site, not just this admin's: anyone who
		// may share may also release the people another admin's link
		// pinned — the fallback for an admin who left.
		foreach ( openstation_workspace_shares_list() as $share ) {
			$author   = get_userdata( $share['author'] );
			$shares[] = array(
				'id'         => $share['id'],
				'label'      => $share['label'],
				'desktop'    => $share['desktop'],
				'url'        => $share['url'],
				'version'    => $share['version'],
				'disabled'   => $share['disabled'],
				'hash'       => $share['hash'],
				'mine'       => $share['author'] === $user_id,
				'authorName' => $author ? (string) $author->display_name : __( 'A former admin', 'desktop-mode' ),
				'claimants'  => openstation_workspace_share_claimants( $share['id'] ),
			);
		}
	}
	return array(
		'canShare' => $can_share,
		'shares'   => $shares,
	);
}

return App::define( APP_ID )
	->title( __( 'Workspaces', 'desktop-mode' ) )
	->icon( 'dashicons-screenoptions' )
	->size( 780, 640 )
	->min_size( 480, 400 )
	// Opened from the overview (Manage), ⌘K and the Save toast; the
	// Workspaces tile itself is Overview, which is where desks are.
	->placement( 'none' )
	->capabilities( 'read' )
	->can( __NAMESPACE__ . '\\can_use' )
	// `focus` is the desk the window was opened on — Manage under a
	// tile, or the Save toast — so the view can bring it to the top.
	// `mio` asks for MIO's chat on open — the dock's "Build a workspace
	// with MIO…".
	->state(
		array(
			'focus' => '',
			'mio'   => false,
		)
	)
	->mount(
		static function ( State $state, Os $os ) {
			$state->set( 'focus', sanitize_key( (string) $os->param( 'desktop', '' ) ) );
			$state->set( 'mio', (bool) $os->param( 'mio', false ) );
		}
	)
	->action(
		'reopen',
		static function ( State $state, Os $os ) {
			$state->set( 'focus', sanitize_key( (string) $os->param( 'desktop', '' ) ) );
			$state->set( 'mio', (bool) $os->param( 'mio', false ) );
		}
	)
	->data( __NAMESPACE__ . '\\data' )
	// Share, or publish changes to an existing share — one call: the
	// store republishes when this author already shared this desk.
	->action(
		'share',
		static function ( State $state, Os $os, array $args ) {
			require_share( $os );
			$profile = isset( $args['profile'] ) && is_string( $args['profile'] ) ? json_decode( $args['profile'], true ) : null;
			$result  = openstation_workspace_share_publish(
				$os->auth->user_id(),
				isset( $args['desktop'] ) ? (string) $args['desktop'] : '',
				isset( $args['label'] ) ? (string) $args['label'] : '',
				$profile
			);
			if ( is_wp_error( $result ) ) {
				throw new \RuntimeException( esc_html( $result->get_error_message() ) );
			}
			$hash = isset( $args['hash'] ) ? preg_replace( '/[^a-f0-9]/', '', strtolower( (string) $args['hash'] ) ) : '';
			update_post_meta( $result['id'], OPENSTATION_WORKSPACE_SHARE_HASH_META, substr( $hash, 0, 16 ) );
		}
	)
	->action(
		'rename',
		static function ( State $state, Os $os, array $args ) {
			require_share( $os );
			$share = share_arg( $args );
			wp_update_post(
				array(
					'ID'         => $share['id'],
					'post_title' => openstation_workspace_share_sanitize_label( $args['label'] ?? '' ),
				)
			);
		}
	)
	->action(
		'new_link',
		static function ( State $state, Os $os, array $args ) {
			require_share( $os );
			$share = share_arg( $args );
			openstation_workspace_share_rotate_token( $share['id'] );
			$os->toast( __( 'New link ready. The old one no longer works; people already using the workspace keep it.', 'desktop-mode' ), 'success' );
		}
	)
	->action(
		'set_disabled',
		static function ( State $state, Os $os, array $args ) {
			require_share( $os );
			$share    = share_arg( $args );
			$disabled = ! empty( $args['disabled'] ) && 'false' !== $args['disabled'];
			openstation_workspace_share_set_disabled( $share['id'], $disabled );
			$os->toast( $disabled ? __( 'Link turned off. The people already using it keep their desk.', 'desktop-mode' ) : __( 'Link turned back on.', 'desktop-mode' ) );
		}
	)
	->action(
		'release',
		static function ( State $state, Os $os, array $args ) {
			require_share( $os );
			$share = share_arg( $args );
			$user  = isset( $args['user'] ) ? absint( $args['user'] ) : 0;
			$users = $user ? array( $user ) : openstation_workspace_share_pinned_users( $share['id'] );
			$count = 0;
			foreach ( $users as $user_id ) {
				$pin = openstation_workspace_pin_get( $user_id );
				// Only people THIS share pinned — a user id in the args
				// is not a licence to release someone from another one.
				if ( $pin && $share['id'] === $pin['share'] && openstation_workspace_pin_release( $user_id ) ) {
					++$count;
				}
			}
			$os->toast(
				sprintf(
					/* translators: %d: number of people released. */
					_n( '%d person released. They have their own desks back.', '%d people released. They have their own desks back.', $count, 'desktop-mode' ),
					$count
				),
				'success'
			);
		}
	)
	->action(
		'delete_share',
		static function ( State $state, Os $os, array $args ) {
			require_share( $os );
			$share = share_arg( $args );
			openstation_workspace_share_delete( $share['id'] );
			$os->toast( __( 'Link deleted, and everyone it pinned released.', 'desktop-mode' ), 'success' );
		}
	);
