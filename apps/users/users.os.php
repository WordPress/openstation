<?php
/**
 * Users — the Users window, as an OpenStation app.
 *
 * Claims the FROZEN id `desktop-mode-users` (see AGENTS.md) so the
 * `users.php` URL remap, session restores and every hook keep
 * working. The body is `users.os.ts`, a client view over the rows
 * `data()` reads from `wp/v2/users` in-process — the same collection,
 * fields and filterable query, plus a page of content counts in two
 * grouped queries. The mutations are actions over the functions in
 * `parts/rest.php`, which the `desktop-mode/v1/users*` routes expose
 * too. The Profile tab hosts `<os-user-profile>` from the companion
 * bundle `parts/profile-script.php` registers.
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
require_once __DIR__ . '/parts/color-schemes.php';
require_once __DIR__ . '/parts/fields.php';
require_once __DIR__ . '/parts/facts.php';
require_once __DIR__ . '/parts/rest.php';
require_once __DIR__ . '/parts/profile-script.php';

/** The `orderby` values `wp/v2/users` accepts that the table offers. */
const SORT_KEYS = array( 'name', 'registered_date', 'email' );

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
 * Say what a mutation did.
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

/**
 * How many of a bulk result's rows succeeded.
 *
 * @param array<string,mixed> $result Bulk result.
 * @return int
 */
function ok_count( array $result ) {
	return count(
		array_filter(
			(array) $result['results'],
			static function ( $row ) {
				return ! empty( $row['ok'] );
			}
		)
	);
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
	->config( 'openstation_users_profile_facts' )
	->state(
		array(
			'page'        => 1,
			'perPage'     => 20,
			'search'      => '',
			// The presence filter (All / Online / Active 30d / Never
			// logged in) — a client-side slice of the page.
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
	// A column header click; the table's keys map to the collection's.
	->action(
		'sort',
		static function ( State $state, Os $os, array $args ) {
			$orderby = sanitize_key( (string) ( $args['orderby'] ?? 'name' ) );
			$state->set( 'orderby', in_array( $orderby, SORT_KEYS, true ) ? $orderby : 'name' );
			$state->set( 'order', 'desc' === strtolower( (string) ( $args['order'] ?? 'asc' ) ) ? 'desc' : 'asc' );
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
					$ok = ok_count( $result );
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
					$ok = ok_count( $result );
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
	// user created anywhere: the list repaints (the app's own announces
	// are skipped by the runtime — the action already returned the rows).
	->watch( 'user' )
	->data(
		static function ( State $state ) {
			$list = openstation_app_rest_page( 'wp/v2/users', list_query( $state ) );
			// Page out of range — the user was on page 7 and changed the
			// page size. Land on page 1 rather than paint an empty table.
			if ( $state->get( 'page' ) > 1 && openstation_app_rest_page_is_out_of_range( $list ) ) {
				$state->set( 'page', 1 );
				$list = openstation_app_rest_page( 'wp/v2/users', list_query( $state ) );
			}
			// The Content column: the page's counts in two grouped
			// queries, merged in under the name the REST field uses.
			$stats = openstation_users_window_stats_for( wp_list_pluck( $list['items'], 'id' ) );
			foreach ( $list['items'] as $i => $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( isset( $stats[ $id ] ) ) {
					$list['items'][ $i ]['openstation_user_stats'] = $stats[ $id ];
				}
			}
			return array( 'list' => $list );
		}
	);
