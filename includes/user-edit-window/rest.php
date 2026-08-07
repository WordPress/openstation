<?php
/**
 * OpenStation — Native User Edit Window: insights endpoint.
 *
 * `GET /desktop-mode/v1/users/<id>/insights` — returns a single
 * payload with everything the Insights tab needs:
 *
 *   - profileCompleteness: filled vs total core fields, percent
 *   - stats: posts / pages / comments / media / approved-comments
 *     received on own posts / days since registration / last login
 *   - contentByMonth: last 12 months of posts authored (for the
 *     mini activity chart)
 *   - recentPosts: last 5 posts the user authored, with status +
 *     comment count
 *   - recentComments: last 5 comments the user wrote (NOT comments
 *     ON their posts — comments BY them, including on their own
 *     content)
 *   - sessions: count of active session tokens (from
 *     `WP_Session_Tokens`); `current` flagged when known
 *   - applicationPasswords: count + most-recently-used summary
 *   - lastLoginAt: UTC unix timestamp from
 *     `_desktop_mode_last_login_at` user meta
 *
 * Server-side caching: each user's insights are computed at most
 * once per minute (transient cache keyed by user_id). The numbers
 * are eventually-consistent — cheaper than re-running 6 SQL
 * aggregates on every form interaction.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_user_edit_window_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/insights',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_user_edit_window_rest_insights',
			'permission_callback' => static function ( $req ) {
				$id = (int) $req->get_param( 'id' );
				return openstation_user_edit_window_can_edit(
					(int) get_current_user_id(),
					$id
				);
			},
			'args'                => array(
				'id'    => array(
					'required' => true,
					'type'     => 'integer',
				),
				'fresh' => array(
					'type' => 'boolean',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_user_edit_window_register_rest_routes' );

/**
 * Register the personal-options user-meta keys with `show_in_rest`
 * so the Profile form can save them via core's
 * `PUT /wp/v2/users/<id>` `meta` field.
 *
 * Without this, the meta keys exist (core uses them on the
 * classic profile.php save) but the REST controller ignores
 * `meta.rich_editing` etc. on update.
 */
function openstation_user_edit_window_register_meta() {
	$keys = array(
		'rich_editing'         => 'string',
		'syntax_highlighting'  => 'string',
		'admin_color'          => 'string',
		'comment_shortcuts'    => 'string',
		'show_admin_bar_front' => 'string',
	);
	foreach ( $keys as $meta_key => $type ) {
		register_meta(
			'user',
			$meta_key,
			array(
				'type'              => $type,
				'single'            => true,
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => $type,
						'context' => array( 'view', 'edit' ),
					),
				),
				'auth_callback'     => static function ( $allowed, $meta_key2, $user_id ) {
					unset( $meta_key2 );
					return current_user_can( 'edit_user', (int) $user_id );
				},
				'sanitize_callback' => 'sanitize_text_field',
			)
		);
	}
}
add_action( 'init', 'openstation_user_edit_window_register_meta' );

/**
 * `POST /users/<id>/destroy-other-sessions` — log out everywhere
 * else (current device kept). Mirrors the WP-core
 * `destroy-sessions` AJAX action.
 */
function openstation_user_edit_window_destroy_sessions_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/destroy-sessions',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_user_edit_window_rest_destroy_sessions',
			'permission_callback' => static function ( $req ) {
				$id = (int) $req->get_param( 'id' );
				return openstation_user_edit_window_can_edit(
					(int) get_current_user_id(),
					$id
				);
			},
			'args'                => array(
				'id'    => array(
					'required' => true,
					'type'     => 'integer',
				),
				'scope' => array(
					'type'    => 'string',
					'default' => 'others',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_user_edit_window_destroy_sessions_route' );

function openstation_user_edit_window_rest_destroy_sessions( $req ) {
	$id    = (int) $req->get_param( 'id' );
	$scope = (string) $req->get_param( 'scope' );
	if ( ! class_exists( 'WP_Session_Tokens' ) ) {
		return new WP_Error(
			'openstation_users_no_sessions',
			__( 'Session manager unavailable.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}
	$manager = WP_Session_Tokens::get_instance( $id );
	if ( 'all' === $scope || (int) get_current_user_id() !== $id ) {
		// Editing another user — destroy ALL of their sessions.
		// Editing self with scope='all' — destroy all (including
		// the current). Note the latter logs the requester out.
		$manager->destroy_all();
	} else {
		$manager->destroy_others( wp_get_session_token() );
	}
	// Bust the insights cache so the sessions count refreshes.
	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response( array( 'ok' => true ) );
}

/**
 * `GET /users/<id>/application-passwords` — list app passwords.
 * `POST /users/<id>/application-passwords` — create new.
 * `DELETE /users/<id>/application-passwords/<uuid>` — revoke one.
 *
 * Thin wrappers over `WP_Application_Passwords` so the form has a
 * single REST surface to talk to.
 */
function openstation_user_edit_window_app_passwords_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/application-passwords',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_user_edit_window_rest_app_pw_list',
				'permission_callback' => static function ( $req ) {
					return openstation_user_edit_window_can_edit(
						(int) get_current_user_id(),
						(int) $req->get_param( 'id' )
					);
				},
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_user_edit_window_rest_app_pw_create',
				'permission_callback' => static function ( $req ) {
					return openstation_user_edit_window_can_edit(
						(int) get_current_user_id(),
						(int) $req->get_param( 'id' )
					);
				},
				'args'                => array(
					'name' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/application-passwords/(?P<uuid>[a-f0-9-]+)',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'openstation_user_edit_window_rest_app_pw_revoke',
			'permission_callback' => static function ( $req ) {
				return openstation_user_edit_window_can_edit(
					(int) get_current_user_id(),
					(int) $req->get_param( 'id' )
				);
			},
		)
	);
}
add_action( 'rest_api_init', 'openstation_user_edit_window_app_passwords_routes' );

/**
 * Enforce core's application-password availability policy for a
 * target user. Mirrors `WP_REST_Application_Passwords_Controller`'s
 * permission check: every operation is rejected when the feature is
 * disabled site-wide (`wp_is_application_passwords_available()`) or
 * for the target user
 * (`wp_is_application_passwords_available_for_user()`) — both of
 * which are filterable by security plugins.
 *
 * @param int $user_id Target user id.
 * @return WP_Error|null Error when unavailable, null when allowed.
 */
function openstation_user_edit_window_app_pw_unavailable( $user_id ) {
	if (
		! function_exists( 'wp_is_application_passwords_available' )
		|| ! wp_is_application_passwords_available()
		|| ! wp_is_application_passwords_available_for_user( (int) $user_id )
	) {
		return new WP_Error(
			'openstation_users_app_pw_unavailable',
			__( 'Application passwords are not available for this user.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}
	return null;
}

function openstation_user_edit_window_rest_app_pw_list( $req ) {
	if ( ! class_exists( 'WP_Application_Passwords' ) ) {
		return rest_ensure_response( array( 'items' => array() ) );
	}
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	$apps = (array) WP_Application_Passwords::get_user_application_passwords( $id );
	return rest_ensure_response( array( 'items' => $apps ) );
}

function openstation_user_edit_window_rest_app_pw_create( $req ) {
	if ( ! class_exists( 'WP_Application_Passwords' ) ) {
		return new WP_Error(
			'openstation_users_app_pw_unavailable',
			__( 'Application passwords are not available on this site.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	$name = sanitize_text_field( (string) $req->get_param( 'name' ) );
	if ( '' === $name ) {
		return new WP_Error(
			'openstation_users_app_pw_name_required',
			__( 'Application password name is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$created = WP_Application_Passwords::create_new_application_password( $id, array( 'name' => $name ) );
	if ( is_wp_error( $created ) ) {
		return $created;
	}
	list( $unhashed_password, $item ) = $created;
	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response(
		array(
			'ok'       => true,
			'password' => $unhashed_password,
			'item'     => $item,
		)
	);
}

function openstation_user_edit_window_rest_app_pw_revoke( $req ) {
	if ( ! class_exists( 'WP_Application_Passwords' ) ) {
		return new WP_Error(
			'openstation_users_app_pw_unavailable',
			__( 'Application passwords are not available on this site.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	$uuid = (string) $req->get_param( 'uuid' );
	$ok   = WP_Application_Passwords::delete_application_password( $id, $uuid );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response( array( 'ok' => true ) );
}

/**
 * `GET /users/<id>/insights` callback.
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function openstation_user_edit_window_rest_insights( $req ) {
	$id   = (int) $req->get_param( 'id' );
	$user = $id > 0 ? get_userdata( $id ) : null;
	if ( ! $user instanceof WP_User ) {
		return new WP_Error(
			'openstation_users_not_found',
			__( 'User not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$fresh     = (bool) $req->get_param( 'fresh' );
	$cache_key = 'dm_user_insights_' . $id;
	$payload   = null;
	if ( ! $fresh ) {
		$cached = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			$payload = $cached;
		}
	}
	if ( null === $payload ) {
		$payload = openstation_user_edit_window_compute_insights( $user );
	}

	// Self-view override — the viewer is by definition logged in
	// right now since they're staring at their own profile. If the
	// `_desktop_mode_last_login_at` meta isn't populated yet
	// (account predates the plugin install, or the wp_login hook
	// fires after the first profile open on a single-tick login)
	// the tile would read "Never" — contradicting the obvious. Pin
	// to current time and lazily backfill the meta so future reads
	// no longer depend on this override. Lives OUTSIDE
	// `compute_insights` so it applies on cache hits AS WELL AS
	// fresh computes.
	$viewer_id = (int) get_current_user_id();
	if ( $id === $viewer_id ) {
		$now    = time();
		$stored = (int) get_user_meta(
			$id,
			defined( 'OPENSTATION_LAST_LOGIN_META_KEY' )
				? OPENSTATION_LAST_LOGIN_META_KEY
				: '_desktop_mode_last_login_at',
			true
		);
		if ( $stored <= 0 ) {
			update_user_meta(
				$id,
				defined( 'OPENSTATION_LAST_LOGIN_META_KEY' )
					? OPENSTATION_LAST_LOGIN_META_KEY
					: '_desktop_mode_last_login_at',
				$now
			);
			$stored = $now;
		}
		// Always reflect the truth on the payload — cached payloads
		// from before the meta-backfill would otherwise still carry
		// the stale `null`.
		if ( ! isset( $payload['stats'] ) || ! is_array( $payload['stats'] ) ) {
			$payload['stats'] = array();
		}
		if ( empty( $payload['stats']['lastLoginAt'] ) ) {
			$payload['stats']['lastLoginAt']        = $stored;
			$payload['stats']['daysSinceLastLogin'] = max(
				0,
				(int) floor( ( $now - $stored ) / DAY_IN_SECONDS )
			);
		}
	}

	/**
	 * Filter the insights payload before it's returned and cached.
	 *
	 * Plugins can append their own metrics (security-event counts,
	 * subscription tier, last-orders-placed, …) by extending the
	 * `stats` map or adding new top-level keys. The JS bundle
	 * tolerates unknown keys — they're surfaced as plugin tiles
	 * when they match the expected shape.
	 *
	 * @param array   $payload Insights payload.
	 * @param WP_User $user    Target user.
	 */
	$payload = (array) apply_filters( 'openstation_user_edit_window_insights', $payload, $user );

	set_transient( $cache_key, $payload, MINUTE_IN_SECONDS );

	return rest_ensure_response( $payload );
}

/**
 * Compute the insights payload for a user. Centralized so plugins
 * can call it directly from a custom REST route or admin notice
 * without going through the HTTP cycle.
 *
 * @param WP_User $user
 * @return array
 */
function openstation_user_edit_window_compute_insights( WP_User $user ) {
	$id = (int) $user->ID;

	// ── Profile completeness — count which core fields are non-empty.
	$completeness_fields = array(
		'first_name'  => (string) $user->first_name,
		'last_name'   => (string) $user->last_name,
		'nickname'    => (string) $user->nickname,
		'description' => (string) $user->description,
		'user_url'    => (string) $user->user_url,
		'user_email'  => (string) $user->user_email,
	);
	$filled              = 0;
	foreach ( $completeness_fields as $value ) {
		if ( '' !== trim( $value ) ) {
			++$filled;
		}
	}
	$total   = count( $completeness_fields );
	$percent = $total > 0 ? (int) round( ( $filled / $total ) * 100 ) : 0;

	// ── Per-CPT post counts. `count_user_posts` does the cheap thing.
	$post_count       = (int) count_user_posts( $id, 'post', true );
	$page_count       = post_type_exists( 'page' )
		? (int) count_user_posts( $id, 'page', true )
		: 0;
	$attachment_count = (int) count_user_posts( $id, 'attachment', true );

	// ── Comments authored by this user (not received).
	$comment_count = (int) get_comments(
		array(
			'user_id' => $id,
			'count'   => true,
		)
	);

	// ── Approved comments RECEIVED on this user's published posts.
	// Cheap aggregate — one COUNT, no row hydration.
	global $wpdb;
	$received_comments = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(c.comment_ID)
			 FROM {$wpdb->comments} c
			 INNER JOIN {$wpdb->posts} p
			   ON p.ID = c.comment_post_ID
			 WHERE p.post_author = %d
			 AND p.post_status = 'publish'
			 AND c.comment_approved = '1'",
			$id
		)
	);

	// ── Months for the activity sparkline. Bucket published posts
	// by year-month for the last 12 months. SQL bucket → align in PHP.
	$month_buckets = array();
	$now           = time();
	for ( $i = 11; $i >= 0; $i-- ) {
		$ts                    = strtotime( "-{$i} months", $now );
		$key                   = gmdate( 'Y-m', $ts );
		$month_buckets[ $key ] = 0;
	}
	$rows = (array) $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE_FORMAT( post_date_gmt, '%%Y-%%m' ) AS bucket,
			        COUNT(*) AS cnt
			 FROM {$wpdb->posts}
			 WHERE post_author = %d
			 AND post_status IN ( 'publish', 'private', 'future' )
			 AND post_date_gmt >= %s
			 GROUP BY bucket
			 ORDER BY bucket ASC",
			$id,
			gmdate( 'Y-m-01 00:00:00', strtotime( '-12 months', $now ) )
		),
		ARRAY_A
	);
	foreach ( $rows as $row ) {
		$bucket = isset( $row['bucket'] ) ? (string) $row['bucket'] : '';
		if ( isset( $month_buckets[ $bucket ] ) ) {
			$month_buckets[ $bucket ] = (int) $row['cnt'];
		}
	}
	$content_by_month = array();
	foreach ( $month_buckets as $bucket => $cnt ) {
		$content_by_month[] = array(
			'month' => $bucket,
			'count' => $cnt,
		);
	}

	// ── Recent posts (any status). Limit 5.
	$recent_posts = array();
	$recent       = get_posts(
		array(
			'author'         => $id,
			'post_type'      => 'any',
			'post_status'    => array(
				'publish',
				'draft',
				'pending',
				'future',
				'private',
			),
			'posts_per_page' => 5,
			'orderby'        => 'date',
			'order'          => 'DESC',
		)
	);
	foreach ( $recent as $post ) {
		// `post_date_gmt` is `'0000-00-00 00:00:00'` for drafts that
		// have never been published — the JS Date.parse of that
		// returns NaN, and the previous fallback rendered every
		// draft's "recent activity" timestamp as "just now". Use
		// `get_gmt_from_date( post_date )` to convert the always-set
		// local `post_date` to UTC when the GMT field is zero.
		$gmt = (string) $post->post_date_gmt;
		if ( '' === $gmt || 0 === strpos( $gmt, '0000-00-00' ) ) {
			$gmt = (string) get_gmt_from_date( (string) $post->post_date );
		}
		$recent_posts[] = array(
			'id'           => (int) $post->ID,
			'title'        => '' !== $post->post_title
				? $post->post_title
				: __( '(no title)', 'desktop-mode' ),
			'status'       => (string) $post->post_status,
			'type'         => (string) $post->post_type,
			'dateGmt'      => $gmt,
			'commentCount' => (int) $post->comment_count,
			'permalink'    => (string) get_permalink( $post ),
			'editUrl'      => (string) get_edit_post_link( $post->ID, 'raw' ),
		);
	}

	// ── Recent comments authored by this user. Limit 5.
	$recent_comments = array();
	$comments        = get_comments(
		array(
			'user_id' => $id,
			'number'  => 5,
			'orderby' => 'comment_date_gmt',
			'order'   => 'DESC',
		)
	);
	foreach ( (array) $comments as $comment ) {
		$post_title = '';
		if ( $comment->comment_post_ID ) {
			$post = get_post( (int) $comment->comment_post_ID );
			if ( $post instanceof WP_Post ) {
				$post_title = '' !== $post->post_title
					? $post->post_title
					: __( '(no title)', 'desktop-mode' );
			}
		}
		// Same zero-date fallback as recent posts above.
		$comment_gmt = (string) $comment->comment_date_gmt;
		if ( '' === $comment_gmt || 0 === strpos( $comment_gmt, '0000-00-00' ) ) {
			$comment_gmt = (string) get_gmt_from_date(
				(string) $comment->comment_date
			);
		}
		$recent_comments[] = array(
			'id'        => (int) $comment->comment_ID,
			'postId'    => (int) $comment->comment_post_ID,
			'postTitle' => $post_title,
			'excerpt'   => wp_trim_words(
				wp_strip_all_tags( (string) $comment->comment_content ),
				24
			),
			'dateGmt'   => $comment_gmt,
			'approved'  => '1' === (string) $comment->comment_approved,
		);
	}

	// ── Active sessions (`WP_Session_Tokens`). The token bag is a
	// blob of metadata per device — UA / IP / login + expiration. We
	// surface a per-session row plus a current-session flag.
	$sessions = array();
	if ( class_exists( 'WP_Session_Tokens' ) ) {
		$manager       = WP_Session_Tokens::get_instance( $id );
		$current_token = wp_get_session_token();
		// The meta blob's keys are *verifiers* — hashes of the raw
		// cookie token (`WP_Session_Tokens::hash_token()`), so hash
		// the current token the same way before comparing.
		$current_verifier = '';
		if ( $current_token ) {
			$current_verifier = function_exists( 'hash' )
				? hash( 'sha256', $current_token )
				: sha1( $current_token );
		}
		// `get_all` returns the tokens-as-array but doesn't expose
		// the token id — peek into the meta blob via the user meta
		// key directly so we can flag the "current" session.
		$raw_tokens = (array) get_user_meta( $id, 'session_tokens', true );
		// Prune expired entries the same way `WP_Session_Tokens`
		// does on its own write path (so a user who hasn't logged
		// in for a while doesn't show stale device rows).
		$now_ts = time();
		foreach ( $raw_tokens as $hash => $info ) {
			if ( ! is_array( $info ) ) {
				continue;
			}
			$expires = isset( $info['expiration'] ) ? (int) $info['expiration'] : 0;
			if ( $expires > 0 && $expires < $now_ts ) {
				continue;
			}
			$sessions[] = array(
				'expiration' => $expires,
				'login'      => isset( $info['login'] ) ? (int) $info['login'] : 0,
				'ip'         => isset( $info['ip'] ) ? (string) $info['ip'] : '',
				'ua'         => isset( $info['ua'] ) ? (string) $info['ua'] : '',
				'current'    => '' !== $current_verifier && $current_verifier === $hash,
			);
		}
		unset( $manager ); // unused but instantiated for symmetry / future use.
	}

	// ── Application passwords (WordPress 5.6+). Stored as user meta.
	$app_passwords_summary = array(
		'total'        => 0,
		'lastUsedAt'   => null,
		'lastUsedName' => null,
	);
	if ( class_exists( 'WP_Application_Passwords' ) ) {
		$apps                           = WP_Application_Passwords::get_user_application_passwords( $id );
		$apps                           = is_array( $apps ) ? $apps : array();
		$app_passwords_summary['total'] = count( $apps );
		$best_used_ts                   = 0;
		$best_used_name                 = null;
		foreach ( $apps as $app ) {
			$used = isset( $app['last_used'] ) ? (int) $app['last_used'] : 0;
			if ( $used > $best_used_ts ) {
				$best_used_ts   = $used;
				$best_used_name = isset( $app['name'] ) ? (string) $app['name'] : null;
			}
		}
		if ( $best_used_ts > 0 ) {
			$app_passwords_summary['lastUsedAt']   = $best_used_ts;
			$app_passwords_summary['lastUsedName'] = $best_used_name;
		}
	}

	// ── Misc / temporal stats.
	$registered_ts           = strtotime( (string) $user->user_registered . ' UTC' );
	$days_since_registration = $registered_ts
		? max( 0, (int) floor( ( time() - $registered_ts ) / DAY_IN_SECONDS ) )
		: null;
	$last_login_ts           = (int) get_user_meta(
		$id,
		defined( 'OPENSTATION_LAST_LOGIN_META_KEY' )
			? OPENSTATION_LAST_LOGIN_META_KEY
			: '_desktop_mode_last_login_at',
		true
	);
	$last_login_ts           = $last_login_ts > 0 ? $last_login_ts : null;
	$days_since_last_login   = $last_login_ts
		? max( 0, (int) floor( ( time() - $last_login_ts ) / DAY_IN_SECONDS ) )
		: null;

	// ── Roles + capabilities count for the profile chip strip.
	$roles      = array_values( (array) $user->roles );
	$caps_count = is_array( $user->allcaps ) ? count(
		array_filter(
			$user->allcaps,
			static function ( $v ) {
				return (bool) $v;
			}
		)
	) : 0;

	return array(
		'userId'               => $id,
		'displayName'          => (string) $user->display_name,
		'avatarUrl'            => (string) get_avatar_url( $id, array( 'size' => 96 ) ),
		'profileUrl'           => (string) get_author_posts_url( $id ),
		'roles'                => $roles,
		'capabilitiesCount'    => $caps_count,
		'profileCompleteness'  => array(
			'filled'  => $filled,
			'total'   => $total,
			'percent' => $percent,
		),
		'stats'                => array(
			'posts'                 => $post_count,
			'pages'                 => $page_count,
			'attachments'           => $attachment_count,
			'commentsAuthored'      => $comment_count,
			'commentsReceived'      => $received_comments,
			'daysSinceRegistration' => $days_since_registration,
			'lastLoginAt'           => $last_login_ts,
			'daysSinceLastLogin'    => $days_since_last_login,
			'registeredAt'          => $registered_ts ? $registered_ts : null,
		),
		'contentByMonth'       => $content_by_month,
		'recentPosts'          => $recent_posts,
		'recentComments'       => $recent_comments,
		'sessions'             => $sessions,
		'applicationPasswords' => $app_passwords_summary,
	);
}
