<?php
/**
 * Users — the native Users window, as an OpenStation app.
 *
 * Claims the FROZEN id `desktop-mode-users` (see AGENTS.md) so the
 * `users.php` URL remap, session restores and every hook keep
 * working. The body is `users.os.ts`, a client view over the rows
 * `data()` reads from `wp/v2/users` in-process — the same collection,
 * fields and filterable query the legacy bundle fetched over HTTP.
 * The mutations are actions over the functions in `parts/rest.php`,
 * which the `desktop-mode/v1/users*` routes still expose.
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard below must land
 * inside that window.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Users;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/login-tracker.php';
require_once __DIR__ . '/parts/fields.php';
require_once __DIR__ . '/parts/rest.php';
// The Profile tab hosts the same `<os-user-profile>` the User Edit
// app does; its colour-scheme catalogue lives beside that app.
require_once dirname( __DIR__ ) . '/user-edit/parts/color-schemes.php';

/**
 * The query the list reads — the filterable defaults plus the state.
 *
 * @param State $state State.
 * @return array<string,mixed>
 */
function list_query( State $state ) {
	$query             = openstation_users_window_default_query_args();
	$query['page']     = max( 1, (int) $state->get( 'page' ) );
	$query['per_page'] = max( 1, (int) $state->get( 'perPage' ) );
	$query['orderby']  = (string) $state->get( 'orderby' );
	$query['order']    = (string) $state->get( 'order' );
	$search            = trim( (string) $state->get( 'search' ) );
	if ( '' !== $search ) {
		$query['search'] = $search;
	}
	return $query;
}

/**
 * The static facts the client view reads once (`ctx.extra`).
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
		'editPostUrlBase' => esc_url_raw( admin_url( 'user-edit.php' ) ),
		// Capability flags — UI hides actions the viewer can't perform.
		// Every action re-checks, so a tampered flag changes nothing.
		'canEdit'         => current_user_can( 'edit_users' ),
		'canPromote'      => current_user_can( 'promote_users' ),
		'canCreate'       => current_user_can( 'create_users' ),
		'canDelete'       => is_multisite() ? current_user_can( 'remove_users' ) : current_user_can( 'delete_users' ),
		'isMultisite'     => is_multisite(),
		'assignableRoles' => openstation_users_window_role_label_map( $viewer_id ),
		'allRoles'        => openstation_users_window_all_roles_map(),
		'locales'         => openstation_users_window_locales_map(),
		'siteLocale'      => (string) get_locale(),
		'defaultRole'     => (string) get_option( 'default_role', 'subscriber' ),
		/** This filter is documented in wp-includes/user.php */
		'contactMethods'  => (array) apply_filters( 'user_contactmethods', array(), null ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter; the window must offer the same contact fields profile.php does.
		'colorSchemes'    => openstation_user_edit_window_color_schemes(),
	);
}

/**
 * Say what a mutation did, the way the legacy bundle did.
 *
 * @param Os              $os     Host handle.
 * @param array|\WP_Error $result The mutation's answer.
 * @param callable        $ok     `function ( array $result ): string` — the success message.
 * @return bool Whether it succeeded.
 */
function report( Os $os, $result, callable $ok ) {
	if ( is_wp_error( $result ) ) {
		$os->toast( $result->get_error_message() );
		return false;
	}
	$os->toast( $ok( $result ) );
	return true;
}

return App::define( 'desktop-mode-users' )
	->title( __( 'Users', 'desktop-mode' ) )
	->icon( 'dashicons-admin-users' )
	->size( 1100, 720 )
	->min_size( 720, 480 )
	// The Users dock tile lives in WordPress's `$menu`; the URL remap
	// routes its click here when the opt-in is on.
	->placement( 'none' )
	->can(
		static function () {
			return openstation_users_window_user_can_register();
		}
	)
	// Resolved when the window registers, for the viewer registering it.
	->config( __NAMESPACE__ . '\facts' )
	->state(
		array(
			'page'        => 1,
			'perPage'     => 20,
			'search'      => '',
			// The presence filter (All / Online / Active 30d / Never
			// logged in) — a client-side slice of the page, as before.
			'status'      => '',
			'orderby'     => 'name',
			'order'       => 'asc',
			// The tab strip: `all` | `add-new` | `edit`.
			'tab'         => 'all',
			// The Add User form's last failure, for the field it names.
			'createError' => '',
			'createField' => '',
			// Bumped on every successful create — the form resets on it.
			'created'     => 0,
		)
	)
	// A query change replaces the result set — back to the first page.
	->action(
		'filter',
		static function ( State $state ) {
			$state->set( 'page', 1 );
		}
	)
	->action(
		'page',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'page', max( 1, (int) ( $args['page'] ?? 1 ) ) );
		}
	)
	->action(
		'bulk-role',
		static function ( State $state, Os $os, array $args ) {
			if ( ! $os->can( 'promote_users' ) ) {
				$os->toast( __( 'You are not allowed to change roles.', 'desktop-mode' ) );
				return;
			}
			$ids    = openstation_users_window_clean_ids( $args['ids'] ?? array() );
			$result = openstation_users_window_apply_bulk_role( $ids, (string) ( $args['role'] ?? '' ) );
			$done   = report(
				$os,
				$result,
				static function ( array $result ) use ( $ids ) {
					$ok = count( array_filter( $result['results'], static fn( $row ) => ! empty( $row['ok'] ) ) );
					if ( 0 === $ok ) {
						return __( 'No users updated.', 'desktop-mode' );
					}
					// translators: %1$d users updated, %2$d failed.
					return sprintf( __( 'Role updated for %1$d user(s) (%2$d skipped).', 'desktop-mode' ), $ok, count( $ids ) - $ok );
				}
			);
			if ( $done ) {
				$os->announce( 'user', 'updated', $ids );
			}
		}
	)
	->action(
		'bulk-delete',
		static function ( State $state, Os $os, array $args ) {
			if ( ! $os->can( is_multisite() ? 'remove_users' : 'delete_users' ) ) {
				$os->toast( __( 'You are not allowed to delete users.', 'desktop-mode' ) );
				return;
			}
			$ids    = openstation_users_window_clean_ids( $args['ids'] ?? array() );
			$result = openstation_users_window_apply_bulk_delete( $ids, (int) ( $args['reassign'] ?? 0 ) );
			$done   = report(
				$os,
				$result,
				static function ( array $result ) use ( $ids ) {
					$ok = count( array_filter( $result['results'], static fn( $row ) => ! empty( $row['ok'] ) ) );
					// translators: %1$d users deleted, %2$d skipped.
					return sprintf( __( '%1$d user(s) deleted (%2$d skipped).', 'desktop-mode' ), $ok, count( $ids ) - $ok );
				}
			);
			if ( $done ) {
				$os->announce( 'user', 'deleted', $ids );
			}
		}
	)
	->action(
		'send-reset',
		static function ( State $state, Os $os, array $args ) {
			report(
				$os,
				$os->can( 'edit_users' )
					? openstation_users_window_send_password_reset( (int) ( $args['id'] ?? 0 ) )
					: new \WP_Error( 'openstation_users_forbidden', __( 'You are not allowed to email this user.', 'desktop-mode' ) ),
				static function ( array $result ) {
					// translators: %s is the user's email address.
					return sprintf( __( 'Reset email sent to %s.', 'desktop-mode' ), $result['email'] );
				}
			);
		}
	)
	->action(
		'resend-welcome',
		static function ( State $state, Os $os, array $args ) {
			report(
				$os,
				$os->can( 'edit_users' )
					? openstation_users_window_resend_welcome( (int) ( $args['id'] ?? 0 ) )
					: new \WP_Error( 'openstation_users_forbidden', __( 'You are not allowed to email this user.', 'desktop-mode' ) ),
				static function ( array $result ) {
					// translators: %s is the user's email address.
					return sprintf( __( 'Welcome email resent to %s.', 'desktop-mode' ), $result['email'] );
				}
			);
		}
	)
	->action(
		'create',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'createError', '' );
			$state->set( 'createField', '' );
			if ( ! $os->can( 'create_users' ) ) {
				$state->set( 'createError', __( 'You are not allowed to create users.', 'desktop-mode' ) );
				return;
			}
			$values = is_array( $args['values'] ?? null ) ? $args['values'] : $args;
			$result = openstation_users_window_create_user( $values );
			if ( is_wp_error( $result ) ) {
				$code  = $result->get_error_code();
				$field = '';
				if ( in_array( $code, array( 'openstation_users_username_exists', 'existing_user_login', 'openstation_users_username_invalid', 'openstation_users_username_required' ), true ) ) {
					$field = 'username';
				} elseif ( in_array( $code, array( 'openstation_users_email_exists', 'existing_user_email', 'openstation_users_email_invalid' ), true ) ) {
					$field = 'email';
				} elseif ( 'openstation_users_role_forbidden' === $code ) {
					$field = 'role';
				}
				$state->set( 'createError', $result->get_error_message() );
				$state->set( 'createField', $field );
				$os->toast( $result->get_error_message() );
				return;
			}
			// translators: %s is the user's email address.
			$os->toast( sprintf( __( 'User created — welcome email sent to %s.', 'desktop-mode' ), $result['email'] ) );
			$os->announce( 'user', 'created', array( (int) $result['user_id'] ) );
			// Back to the list, first page, so the new user shows up.
			$state->set( 'tab', 'all' );
			$state->set( 'page', 1 );
			$state->set( 'created', (int) $state->get( 'created' ) + 1 );
		}
	)
	// A profile saved in the User Edit window, a role changed here, a
	// user created anywhere: the list repaints.
	->watch( 'user' )
	->data(
		static function ( State $state ) {
			$list = openstation_app_rest_page( 'wp/v2/users', list_query( $state ) );
			// Page out of range — the user was on page 7 and changed the
			// page size. Core refuses the page outright
			// (`rest_user_invalid_page_number`), so the answer is empty
			// either way: land on page 1 rather than paint an empty table.
			if ( array() === $list['items'] && $state->get( 'page' ) > 1 ) {
				$state->set( 'page', 1 );
				$list = openstation_app_rest_page( 'wp/v2/users', list_query( $state ) );
			}
			return array( 'list' => $list );
		}
	);
