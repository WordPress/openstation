<?php

namespace OpenStation\Apps\Users;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

require_once __DIR__ . '/parts/permissions.php';
require_once __DIR__ . '/parts/login-tracker.php';
require_once __DIR__ . '/parts/color-schemes.php';
require_once __DIR__ . '/parts/fields.php';
require_once __DIR__ . '/parts/roles-summary.php';
require_once __DIR__ . '/parts/activity-summary.php';
require_once __DIR__ . '/parts/facts.php';
require_once __DIR__ . '/parts/rest.php';
require_once __DIR__ . '/parts/profile-script.php';

const SORT_KEYS = array( 'name', 'registered_date', 'email' );

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
	$role = trim( (string) $state->get( 'role' ) );
	if ( 'none' === $role ) {

		$ids              = wp_get_users_with_no_role();
		$query['include'] = $ids ? array_map( 'intval', $ids ) : array( 0 );
	} elseif ( '' !== $role ) {
		$query['roles'] = $role;
	}
	return $query;
}

function report( Os $os, $result, callable $ok ) {
	if ( is_wp_error( $result ) ) {
		$os->toast( $result->get_error_message() );
		return false;
	}
	$os->toast( $ok( $result ) );
	return true;
}

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

	->placement( 'none' )
	->can(
		static function () {
			return openstation_users_window_user_can_register();
		}
	)

	->config( 'openstation_users_profile_facts' )

	->menu(
		'users.php',
		static function () {
			$tabs = array(
				'all'      => array(
					'label' => __( 'People', 'desktop-mode' ),
					'page'  => 'users.php',
				),
				'roles'    => __( 'Roles', 'desktop-mode' ),
				'activity' => __( 'Activity', 'desktop-mode' ),
			);
			if ( current_user_can( 'create_users' ) ) {
				$tabs['add-new'] = array(
					'label' => __( 'Add new', 'desktop-mode' ),
					'page'  => 'user-new.php',
				);
			}
			$tabs['edit'] = array(
				'label' => __( 'Profile', 'desktop-mode' ),
				'page'  => 'profile.php',
			);
			return $tabs;
		},
		'openstation_users_window_user_can_use'
	)
	->state(
		array(
			'page'        => 1,
			'perPage'     => 20,
			'search'      => '',

			'role'        => '',

			'status'      => '',
			'orderby'     => 'name',
			'order'       => 'asc',

			'tab'         => 'all',

			'createError' => '',
			'createField' => '',

			'created'     => 0,
		)
	)

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

			$os->toast( sprintf( __( 'User created — welcome email sent to %s.', 'desktop-mode' ), $result['email'] ) );
			$os->announce( 'user', 'created', array( (int) $result['user_id'] ) );

			$state->set( 'tab', 'all' );
			$state->set( 'page', 1 );
			$state->set( 'created', (int) $state->get( 'created' ) + 1 );
		}
	)

	->watch( 'user' )
	->data(
		static function ( State $state ) {
			$list = openstation_app_rest_page( 'wp/v2/users', list_query( $state ) );

			if ( $state->get( 'page' ) > 1 && openstation_app_rest_page_is_out_of_range( $list ) ) {
				$state->set( 'page', 1 );
				$list = openstation_app_rest_page( 'wp/v2/users', list_query( $state ) );
			}

			$stats = openstation_users_window_stats_for( wp_list_pluck( $list['items'], 'id' ) );
			foreach ( $list['items'] as $i => $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( isset( $stats[ $id ] ) ) {
					$list['items'][ $i ]['openstation_user_stats'] = $stats[ $id ];
				}

				if ( isset( $row['name'] ) ) {
					$list['items'][ $i ]['name'] = openstation_plain_text_title( $row['name'] );
				}
			}
			return array( 'list' => $list );
		}
	);
