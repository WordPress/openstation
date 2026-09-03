<?php
/**
 * User Edit — the profile editor, as an OpenStation app.
 *
 * Claims the FROZEN id `desktop-mode-user-edit` (see AGENTS.md). A
 * singleton that opens on the person carried in its open-time params
 * (`{ userId }` — the `user-edit.php?user_id=N` remap, a Users row,
 * WP Explorer, the agents roster) and falls back to the viewer's own
 * profile (how `profile.php` opens). A live window asked to open on
 * someone else retargets through the `reopen` lifecycle, which
 * replaced the legacy shared-store subscription. The body is
 * `user-edit.os.ts`: `<os-user-profile>` on the state's id — the
 * component the Users app's Profile tab hosts too — reading its
 * facts (roles, locales, colour schemes) from this app's config.
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard below must land
 * inside that window.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\UserEdit;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/color-schemes.php';
require_once __DIR__ . '/parts/rest.php';
// The role and locale maps belong to the Users app; the profile
// form offers the same lists.
require_once dirname( __DIR__ ) . '/users/parts/permissions.php';
require_once dirname( __DIR__ ) . '/users/parts/fields.php';

/**
 * Point the window at the person the params name, or at the viewer.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return void
 */
function retarget( State $state, Os $os ) {
	$user_id = (int) $os->param( 'userId', 0 );
	$state->set( 'userId', $user_id > 0 ? $user_id : (int) get_current_user_id() );
}

/**
 * The static facts `<os-user-profile>` reads (`ctx.extra`, and the
 * window config for the component when it mounts outside a session).
 *
 * @return array<string,mixed>
 */
function facts() {
	$viewer_id = (int) get_current_user_id();
	// The app is never registered for a visitor; skip the catalogue
	// work (locales, colour schemes) on every anonymous request.
	if ( $viewer_id <= 0 ) {
		return array();
	}
	return array(
		'currentUserId'   => $viewer_id,
		'editPostUrlBase' => esc_url_raw( admin_url( 'post.php' ) ),
		'canPromote'      => current_user_can( 'promote_users' ),
		'isMultisite'     => is_multisite(),
		// Roles the viewer may assign — the dropdown lists only these,
		// so a narrowed `editable_roles` never yields "pick a role, hit
		// save, get rejected". `allRoles` is the fallback catalogue.
		'assignableRoles' => openstation_users_window_role_label_map( $viewer_id ),
		'allRoles'        => openstation_users_window_all_roles_map(),
		'locales'         => openstation_users_window_locales_map(),
		/** This filter is documented in wp-includes/user.php */
		'contactMethods'  => (array) apply_filters( 'user_contactmethods', array(), null ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter; the window must offer the same contact fields profile.php does.
		'colorSchemes'    => openstation_user_edit_window_color_schemes(),
	);
}

return App::define( 'desktop-mode-user-edit' )
	->title( __( 'Edit user', 'desktop-mode' ) )
	->icon( 'dashicons-admin-users' )
	->size( 1100, 760 )
	->min_size( 720, 520 )
	->placement( 'none' )
	// The profile surface (`<os-user-profile>`, `.os-users__edit-*`)
	// is styled by the Users app's sheet — one set of rules for the
	// Profile tab and this window. Pointing here registers the same
	// file under this app's own handle, so the window is dressed even
	// when the Users window was never opened.
	->style( dirname( __DIR__ ) . '/users/users.css' )
	->can(
		static function () {
			return openstation_user_edit_window_user_can_register();
		}
	)
	// Resolved when the window registers, for the viewer registering it.
	->config( __NAMESPACE__ . '\facts' )
	->state( array( 'userId' => 0 ) )
	->mount( __NAMESPACE__ . '\retarget' )
	// The singleton reopened on someone else — the shell wrote the new
	// params, the runtime dispatched this.
	->action( 'reopen', __NAMESPACE__ . '\retarget' )
	->data(
		static function ( State $state ) {
			return array( 'userId' => (int) $state->get( 'userId' ) );
		}
	);
