<?php
/**
 * Desktop Mode — Routines: built-in trigger declarations + starter recipes.
 *
 * Two responsibilities:
 *
 *   1. Declare a curated set of WP-core hooks as routine triggers
 *      with friendly labels, payload schemas, and binders. These
 *      land in the trigger picker's "Common" tab.
 *
 *   2. Register three starter recipes so the UI has something to
 *      browse and one-click-install on first run.
 *
 * Hooked on `init` priority 6 — after the CPT registers (priority 5)
 * and well before the trigger listener installs (priority 25).
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the curated trigger catalog + starter recipes.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_built_in_seed() {
	wpdm_routine_register_built_in_triggers();
	wpdm_routine_register_built_in_templates();

	/**
	 * Fires after the built-in trigger and template catalogues have
	 * been registered. Plugin authors that want to ship their own
	 * triggers / templates can hook this OR use `init` directly.
	 *
	 * @since 0.22.0
	 */
	do_action( 'wp_desktop_routine_seeded' );
}
add_action( 'init', 'wpdm_routine_register_built_in_seed', 6 );

/**
 * Curated WP-core trigger catalogue.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_built_in_triggers() {
	$common = array(
		array(
			'id'             => 'publish_post',
			'label'          => __( 'A post is published', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-edit',
			'accepted_args'  => 2,
			'payload_schema' => array(
				'post_id'    => array( 'type' => 'integer' ),
				'post.title' => array( 'type' => 'string' ),
				'post.type'  => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'post_id' => 42, 'post' => array( 'title' => 'Hello world', 'type' => 'post' ) ),
			'binder'         => 'wpdm_routine_bind_post_args',
		),
		array(
			'id'             => 'comment_post',
			'label'          => __( 'A comment is left', 'desktop-mode' ),
			'group'          => __( 'Comments', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-comments',
			'accepted_args'  => 3,
			'payload_schema' => array(
				'comment_id'      => array( 'type' => 'integer' ),
				'approved'        => array( 'type' => 'integer' ),
				'comment.content' => array( 'type' => 'string' ),
				'comment.author'  => array( 'type' => 'string' ),
				'comment.email'   => array( 'type' => 'string' ),
				'comment.post_id' => array( 'type' => 'integer' ),
			),
			'sample_payload' => array(
				'comment_id' => 7,
				'approved'   => 1,
				'comment'    => array( 'content' => 'Great post!', 'author' => 'Jane', 'email' => 'jane@example.com', 'post_id' => 42 ),
			),
			'binder'         => 'wpdm_routine_bind_comment_args',
		),
		array(
			'id'             => 'user_register',
			'label'          => __( 'A user registers', 'desktop-mode' ),
			'group'          => __( 'Users', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-users',
			'accepted_args'  => 1,
			'payload_schema' => array(
				'user_id'    => array( 'type' => 'integer' ),
				'user.email' => array( 'type' => 'string' ),
				'user.login' => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'user_id' => 12, 'user' => array( 'email' => 'new@example.com', 'login' => 'new' ) ),
			'binder'         => 'wpdm_routine_bind_user_register_args',
		),
		array(
			'id'             => 'wp_trash_post',
			'label'          => __( 'A post is moved to trash', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-trash',
			'accepted_args'  => 1,
			'payload_schema' => array( 'post_id' => array( 'type' => 'integer' ) ),
			'sample_payload' => array( 'post_id' => 42 ),
			'binder'         => 'wpdm_routine_bind_post_id_only',
		),
		array(
			'id'             => 'switch_theme',
			'label'          => __( 'The theme is switched', 'desktop-mode' ),
			'group'          => __( 'Site', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-appearance',
			'accepted_args'  => 1,
			'payload_schema' => array( 'theme' => array( 'type' => 'string' ) ),
			'sample_payload' => array( 'theme' => 'twentytwentyfour' ),
			'binder'         => 'wpdm_routine_bind_theme_args',
		),
		array(
			'id'             => 'activated_plugin',
			'label'          => __( 'A plugin is activated', 'desktop-mode' ),
			'group'          => __( 'Site', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-plugins',
			'accepted_args'  => 2,
			'payload_schema' => array( 'plugin' => array( 'type' => 'string' ) ),
			'sample_payload' => array( 'plugin' => 'akismet/akismet.php' ),
			'binder'         => 'wpdm_routine_bind_plugin_args',
		),
		array(
			'id'             => 'save_post',
			'label'          => __( 'Any post is saved', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-saved',
			'accepted_args'  => 3,
			'payload_schema' => array(
				'post_id'    => array( 'type' => 'integer' ),
				'post.title' => array( 'type' => 'string' ),
				'post.type'  => array( 'type' => 'string' ),
				'post.status'=> array( 'type' => 'string' ),
				'is_update'  => array( 'type' => 'boolean', 'description' => 'True for updates, false for new posts' ),
			),
			'sample_payload' => array( 'post_id' => 42, 'is_update' => false ),
			'binder'         => 'wpdm_routine_bind_save_post_args',
		),
		array(
			'id'             => 'transition_post_status',
			'label'          => __( 'A post status changes', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-update-alt',
			'accepted_args'  => 3,
			'payload_schema' => array(
				'new_status' => array( 'type' => 'string' ),
				'old_status' => array( 'type' => 'string' ),
				'post_id'    => array( 'type' => 'integer' ),
				'post.title' => array( 'type' => 'string' ),
				'post.type'  => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'new_status' => 'publish', 'old_status' => 'draft', 'post_id' => 42 ),
			'binder'         => 'wpdm_routine_bind_transition_post_args',
		),
		array(
			'id'             => 'deleted_post',
			'label'          => __( 'A post is permanently deleted', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-no',
			'accepted_args'  => 1,
			'payload_schema' => array( 'post_id' => array( 'type' => 'integer' ) ),
			'sample_payload' => array( 'post_id' => 42 ),
			'binder'         => 'wpdm_routine_bind_post_id_only',
		),
		array(
			'id'             => 'wp_login',
			'label'          => __( 'A user logs in', 'desktop-mode' ),
			'group'          => __( 'Users', 'desktop-mode' ),
			'icon'           => 'dashicons-unlock',
			'accepted_args'  => 2,
			'payload_schema' => array(
				'user_login' => array( 'type' => 'string' ),
				'user.id'    => array( 'type' => 'integer' ),
				'user.email' => array( 'type' => 'string' ),
				'user.roles' => array( 'type' => 'array' ),
			),
			'sample_payload' => array( 'user_login' => 'admin', 'user' => array( 'id' => 1, 'email' => 'a@b.com' ) ),
			'binder'         => 'wpdm_routine_bind_login_args',
		),
		array(
			'id'             => 'wp_login_failed',
			'label'          => __( 'A login attempt fails', 'desktop-mode' ),
			'group'          => __( 'Users', 'desktop-mode' ),
			'icon'           => 'dashicons-warning',
			'accepted_args'  => 2,
			'payload_schema' => array(
				'username' => array( 'type' => 'string' ),
				'error'    => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'username' => 'admin', 'error' => 'incorrect_password' ),
			'binder'         => 'wpdm_routine_bind_login_failed_args',
		),
		array(
			'id'             => 'wp_logout',
			'label'          => __( 'A user logs out', 'desktop-mode' ),
			'group'          => __( 'Users', 'desktop-mode' ),
			'icon'           => 'dashicons-lock',
			'accepted_args'  => 1,
			'payload_schema' => array( 'user_id' => array( 'type' => 'integer' ) ),
			'sample_payload' => array( 'user_id' => 1 ),
			'binder'         => 'wpdm_routine_bind_user_id_only',
		),
		array(
			'id'             => 'profile_update',
			'label'          => __( 'A user profile is updated', 'desktop-mode' ),
			'group'          => __( 'Users', 'desktop-mode' ),
			'icon'           => 'dashicons-id',
			'accepted_args'  => 2,
			'payload_schema' => array(
				'user_id'    => array( 'type' => 'integer' ),
				'user.email' => array( 'type' => 'string' ),
				'user.login' => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'user_id' => 12 ),
			'binder'         => 'wpdm_routine_bind_user_register_args',
		),
		array(
			'id'             => 'password_reset',
			'label'          => __( 'A password is reset', 'desktop-mode' ),
			'group'          => __( 'Users', 'desktop-mode' ),
			'icon'           => 'dashicons-shield',
			'accepted_args'  => 2,
			'payload_schema' => array(
				'user_id'    => array( 'type' => 'integer' ),
				'user.email' => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'user_id' => 12 ),
			'binder'         => 'wpdm_routine_bind_password_reset_args',
		),
		array(
			'id'             => 'attachment_updated',
			'label'          => __( 'An attachment is updated', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-format-image',
			'accepted_args'  => 3,
			'payload_schema' => array(
				'post_id' => array( 'type' => 'integer' ),
			),
			'sample_payload' => array( 'post_id' => 42 ),
			'binder'         => 'wpdm_routine_bind_post_id_only',
		),
		array(
			'id'             => 'updated_option',
			'label'          => __( 'A WordPress option changes', 'desktop-mode' ),
			'group'          => __( 'Site', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-settings',
			'accepted_args'  => 3,
			'payload_schema' => array(
				'option' => array( 'type' => 'string' ),
				'old_value' => array( 'type' => 'string' ),
				'new_value' => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'option' => 'blogname', 'old_value' => 'Old', 'new_value' => 'New' ),
			'binder'         => 'wpdm_routine_bind_option_args',
		),
		array(
			'id'             => 'created_term',
			'label'          => __( 'A taxonomy term is created', 'desktop-mode' ),
			'group'          => __( 'Content', 'desktop-mode' ),
			'icon'           => 'dashicons-tag',
			'accepted_args'  => 3,
			'payload_schema' => array(
				'term_id'  => array( 'type' => 'integer' ),
				'taxonomy' => array( 'type' => 'string' ),
			),
			'sample_payload' => array( 'term_id' => 5, 'taxonomy' => 'category' ),
			'binder'         => 'wpdm_routine_bind_term_args',
		),
		array(
			'id'             => 'wp_desktop_routine_after_run',
			'label'          => __( 'Another routine finishes', 'desktop-mode' ),
			'group'          => __( 'Routines', 'desktop-mode' ),
			'icon'           => 'dashicons-controls-play',
			'accepted_args'  => 4,
			'payload_schema' => array(
				'routine.id'    => array( 'type' => 'integer' ),
				'routine.title' => array( 'type' => 'string' ),
				'status'        => array( 'type' => 'string' ),
			),
			'sample_payload' => array(
				'routine' => array( 'id' => 12, 'title' => 'Spam Sentinel' ),
				'status'  => 'success',
			),
			'binder'         => 'wpdm_routine_bind_after_run_args',
		),
	);

	foreach ( $common as $trigger ) {
		wp_register_desktop_routine_trigger( $trigger );
	}
}

// ---- Binders ---------------------------------------------------------------

/**
 * @since 0.22.0
 *
 * @param int      $post_id Post id.
 * @param \WP_Post $post    Post object.
 * @return array
 */
function wpdm_routine_bind_post_args( $post_id, $post = null ) {
	if ( ! $post instanceof WP_Post ) {
		$post = get_post( (int) $post_id );
	}
	$payload = array( 'post_id' => (int) $post_id );
	if ( $post instanceof WP_Post ) {
		$payload['post'] = array(
			'id'      => (int) $post->ID,
			'title'   => (string) $post->post_title,
			'type'    => (string) $post->post_type,
			'status'  => (string) $post->post_status,
			'author'  => (int) $post->post_author,
			'content' => (string) $post->post_content,
			'excerpt' => (string) $post->post_excerpt,
			'url'     => (string) get_permalink( $post ),
		);
	}
	return $payload;
}

/**
 * @since 0.22.0
 *
 * @param int    $post_id Post id.
 * @return array
 */
function wpdm_routine_bind_post_id_only( $post_id ) {
	return wpdm_routine_bind_post_args( (int) $post_id );
}

/**
 * @since 0.22.0
 *
 * @param int   $comment_id ID.
 * @param mixed $approved   1, 0, or 'spam'.
 * @return array
 */
function wpdm_routine_bind_comment_args( $comment_id, $approved = 0 ) {
	$comment = get_comment( (int) $comment_id );
	$payload = array(
		'comment_id' => (int) $comment_id,
		'approved'   => is_numeric( $approved ) ? (int) $approved : (string) $approved,
	);
	if ( $comment ) {
		$payload['comment'] = array(
			'id'      => (int) $comment->comment_ID,
			'content' => (string) $comment->comment_content,
			'author'  => (string) $comment->comment_author,
			'email'   => (string) $comment->comment_author_email,
			'url'     => (string) $comment->comment_author_url,
			'post_id' => (int) $comment->comment_post_ID,
			'type'    => (string) $comment->comment_type,
		);
	}
	return $payload;
}

/**
 * @since 0.22.0
 *
 * @param int $user_id ID.
 * @return array
 */
function wpdm_routine_bind_user_register_args( $user_id ) {
	$user    = get_user_by( 'id', (int) $user_id );
	$payload = array( 'user_id' => (int) $user_id );
	if ( $user ) {
		$payload['user'] = array(
			'id'    => (int) $user->ID,
			'email' => (string) $user->user_email,
			'login' => (string) $user->user_login,
			'name'  => (string) $user->display_name,
		);
	}
	return $payload;
}

/**
 * @since 0.22.0
 *
 * @param string $theme Theme slug.
 * @return array
 */
function wpdm_routine_bind_theme_args( $theme ) {
	return array( 'theme' => (string) $theme );
}

/**
 * @since 0.22.0
 *
 * @param string $plugin       Plugin file.
 * @param bool   $network_wide Optional.
 * @return array
 */
function wpdm_routine_bind_plugin_args( $plugin, $network_wide = false ) {
	return array( 'plugin' => (string) $plugin, 'network_wide' => (bool) $network_wide );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_save_post_args( $post_id, $post = null, $update = false ) {
	$payload              = wpdm_routine_bind_post_args( (int) $post_id, $post );
	$payload['is_update'] = (bool) $update;
	return $payload;
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_transition_post_args( $new_status, $old_status, $post = null ) {
	$payload = array(
		'new_status' => (string) $new_status,
		'old_status' => (string) $old_status,
	);
	if ( $post instanceof WP_Post ) {
		$payload['post_id'] = (int) $post->ID;
		$payload['post']    = array(
			'id'     => (int) $post->ID,
			'title'  => (string) $post->post_title,
			'type'   => (string) $post->post_type,
			'status' => (string) $post->post_status,
			'author' => (int) $post->post_author,
		);
	}
	return $payload;
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_login_args( $user_login, $user = null ) {
	$payload = array( 'user_login' => (string) $user_login );
	if ( $user instanceof WP_User ) {
		$payload['user'] = array(
			'id'    => (int) $user->ID,
			'email' => (string) $user->user_email,
			'login' => (string) $user->user_login,
			'name'  => (string) $user->display_name,
			'roles' => array_values( (array) $user->roles ),
		);
	}
	return $payload;
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_login_failed_args( $username, $error = null ) {
	$msg = '';
	if ( $error instanceof WP_Error ) {
		$msg = $error->get_error_message();
	} elseif ( is_string( $error ) ) {
		$msg = $error;
	}
	return array(
		'username' => (string) $username,
		'error'    => $msg,
	);
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_user_id_only( $user_id ) {
	return wpdm_routine_bind_user_register_args( (int) $user_id );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_password_reset_args( $user, $new_pass = null ) {
	if ( $user instanceof WP_User ) {
		return array(
			'user_id'    => (int) $user->ID,
			'user'       => array(
				'id'    => (int) $user->ID,
				'email' => (string) $user->user_email,
				'login' => (string) $user->user_login,
			),
		);
	}
	return array( 'user_id' => 0 );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_option_args( $option, $old_value = null, $new_value = null ) {
	return array(
		'option'    => (string) $option,
		'old_value' => is_scalar( $old_value ) ? (string) $old_value : wp_json_encode( $old_value ),
		'new_value' => is_scalar( $new_value ) ? (string) $new_value : wp_json_encode( $new_value ),
	);
}

/**
 * @since 0.22.0
 */
function wpdm_routine_bind_term_args( $term_id, $tt_id = 0, $taxonomy = '' ) {
	return array(
		'term_id'  => (int) $term_id,
		'taxonomy' => (string) $taxonomy,
	);
}

/**
 * @since 0.22.0
 *
 * @param array  $routine Routine row.
 * @param array  $payload Bound payload.
 * @param string $status  Final status.
 * @return array
 */
function wpdm_routine_bind_after_run_args( $routine, $payload = array(), $status = 'success' ) {
	$row = is_array( $routine ) ? $routine : array();
	return array(
		'routine' => array(
			'id'    => (int) ( $row['id'] ?? 0 ),
			'title' => (string) ( $row['title'] ?? '' ),
		),
		'status'  => (string) $status,
	);
}

// ---- Starter templates -----------------------------------------------------

/**
 * Three opinionated starter recipes. The shape exactly matches what
 * the executor reads, so installing one is a single
 * `wp_insert_post` away.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_built_in_templates() {
	$banned = array( 'casino', 'bitcoin', 'viagra', 'porn' );

	wp_register_desktop_routine_template(
		array(
			'id'          => 'spam-sentinel',
			'title'       => __( 'Spam Sentinel', 'desktop-mode' ),
			'description' => __( 'When a comment with banned words arrives, trash it and log the action.', 'desktop-mode' ),
			'icon'        => 'dashicons-shield',
			'group'       => __( 'Comments', 'desktop-mode' ),
			'def'         => array(
				'version'    => 1,
				'trigger'    => array( 'kind' => 'hook', 'id' => 'comment_post', 'priority' => 10 ),
				'conditions' => array(),
				'steps'      => array(
					array(
						'kind'      => 'if',
						'id'        => 'spam_check',
						'condition' => array(
							'left'  => '{{payload.comment.content}}',
							'op'    => 'matches',
							'right' => '/(' . implode( '|', $banned ) . ')/i',
						),
						'then'      => array(
							array(
								'kind' => 'log',
								'id'   => 'log_spam',
								'args' => array(
									'level'   => 'warning',
									'message' => 'Spam Sentinel: trashing comment {{payload.comment_id}} from {{payload.comment.email}}',
								),
							),
							array(
								'kind' => 'action',
								'id'   => 'wpdm.comment.trash',
								'args' => array( 'comment_id' => '{{payload.comment_id}}' ),
							),
						),
						'else'      => array(),
					),
				),
				'run_as'   => 'system',
				'settings' => array(
					'rate_limit'    => array( 'max' => 0, 'per_seconds' => 60 ),
					'timeout_ms'    => 5000,
					'stop_on_error' => false,
				),
			),
		)
	);

	wp_register_desktop_routine_template(
		array(
			'id'          => 'welcome-wagon',
			'title'       => __( 'Welcome Wagon', 'desktop-mode' ),
			'description' => __( 'Email new users a welcome message the moment they register.', 'desktop-mode' ),
			'icon'        => 'dashicons-email',
			'group'       => __( 'Users', 'desktop-mode' ),
			'def'         => array(
				'version'    => 1,
				'trigger'    => array( 'kind' => 'hook', 'id' => 'user_register', 'priority' => 10 ),
				'conditions' => array(),
				'steps'      => array(
					array(
						'kind' => 'email',
						'id'   => 'send_welcome',
						'args' => array(
							'to'      => '{{payload.user.email}}',
							'subject' => 'Welcome to {{site.name}}!',
							'body'    => "Hi {{payload.user.login}},\n\nThanks for signing up at {{site.url}} — we're glad to have you.\n\n— The team",
						),
					),
				),
				'run_as'   => 'system',
				'settings' => array(
					'rate_limit'    => array( 'max' => 0, 'per_seconds' => 60 ),
					'timeout_ms'    => 5000,
					'stop_on_error' => true,
				),
			),
		)
	);

	wp_register_desktop_routine_template(
		array(
			'id'          => 'big-publish-broadcast',
			'title'       => __( 'Publish Broadcast', 'desktop-mode' ),
			'description' => __( 'When a post is published, log a one-line summary so the activity feed stays current.', 'desktop-mode' ),
			'icon'        => 'dashicons-megaphone',
			'group'       => __( 'Content', 'desktop-mode' ),
			'def'         => array(
				'version'    => 1,
				'trigger'    => array( 'kind' => 'hook', 'id' => 'publish_post', 'priority' => 10 ),
				'conditions' => array(),
				'steps'      => array(
					array(
						'kind' => 'log',
						'id'   => 'log_publish',
						'args' => array(
							'level'   => 'info',
							'message' => 'Published: {{payload.post.title}} ({{payload.post.url}})',
						),
					),
				),
				'run_as'   => 'author',
				'settings' => array(
					'rate_limit'    => array( 'max' => 0, 'per_seconds' => 60 ),
					'timeout_ms'    => 5000,
					'stop_on_error' => false,
				),
			),
		)
	);
}

/**
 * Built-in `wpdm.comment.trash` action used by the Spam Sentinel
 * recipe. Registered as a routine action so we don't have to reach
 * into the comment subsystem from the schema layer.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_built_in_actions() {
	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.comment.trash',
			'label'       => __( 'Trash a comment', 'desktop-mode' ),
			'description' => __( 'Move a comment to the trash.', 'desktop-mode' ),
			'icon'        => 'dashicons-trash',
			'group'       => __( 'Comments', 'desktop-mode' ),
			'capability'  => 'moderate_comments',
			'args_schema' => array(
				'comment_id' => array( 'type' => 'integer', 'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_comment_trash',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.post.trash',
			'label'       => __( 'Trash a post', 'desktop-mode' ),
			'description' => __( 'Move a post to the trash.', 'desktop-mode' ),
			'icon'        => 'dashicons-trash',
			'group'       => __( 'Content', 'desktop-mode' ),
			'capability'  => 'delete_posts',
			'args_schema' => array(
				'post_id' => array( 'type' => 'integer', 'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_post_trash',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.post.publish',
			'label'       => __( 'Publish a post', 'desktop-mode' ),
			'description' => __( 'Set a post\'s status to "publish".', 'desktop-mode' ),
			'icon'        => 'dashicons-yes',
			'group'       => __( 'Content', 'desktop-mode' ),
			'capability'  => 'publish_posts',
			'args_schema' => array(
				'post_id' => array( 'type' => 'integer', 'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_post_publish',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.post.update_meta',
			'label'       => __( 'Update post meta', 'desktop-mode' ),
			'description' => __( 'Set a meta key on a post.', 'desktop-mode' ),
			'icon'        => 'dashicons-tag',
			'group'       => __( 'Content', 'desktop-mode' ),
			'capability'  => 'edit_posts',
			'args_schema' => array(
				'post_id'    => array( 'type' => 'integer', 'required' => true ),
				'meta_key'   => array( 'type' => 'string',  'required' => true ),
				'meta_value' => array( 'type' => 'string' ),
			),
			'handler'     => 'wpdm_routine_action_post_update_meta',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.post.assign_term',
			'label'       => __( 'Assign a taxonomy term to a post', 'desktop-mode' ),
			'description' => __( 'Add a category / tag / custom term to a post.', 'desktop-mode' ),
			'icon'        => 'dashicons-category',
			'group'       => __( 'Content', 'desktop-mode' ),
			'capability'  => 'edit_posts',
			'args_schema' => array(
				'post_id'  => array( 'type' => 'integer', 'required' => true ),
				'taxonomy' => array( 'type' => 'string',  'required' => true ),
				'term'     => array( 'type' => 'string',  'required' => true, 'description' => 'Term ID, slug, or name' ),
				'append'   => array( 'type' => 'boolean', 'description' => 'True to add to existing terms; default replaces.' ),
			),
			'handler'     => 'wpdm_routine_action_post_assign_term',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.comment.approve',
			'label'       => __( 'Approve a comment', 'desktop-mode' ),
			'description' => __( 'Move a pending comment to approved.', 'desktop-mode' ),
			'icon'        => 'dashicons-yes-alt',
			'group'       => __( 'Comments', 'desktop-mode' ),
			'capability'  => 'moderate_comments',
			'args_schema' => array(
				'comment_id' => array( 'type' => 'integer', 'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_comment_approve',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.comment.spam',
			'label'       => __( 'Mark a comment as spam', 'desktop-mode' ),
			'description' => __( 'Set comment status to spam.', 'desktop-mode' ),
			'icon'        => 'dashicons-flag',
			'group'       => __( 'Comments', 'desktop-mode' ),
			'capability'  => 'moderate_comments',
			'args_schema' => array(
				'comment_id' => array( 'type' => 'integer', 'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_comment_spam',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.user.update_role',
			'label'       => __( 'Change a user\'s role', 'desktop-mode' ),
			'description' => __( 'Replace a user\'s role with the given one.', 'desktop-mode' ),
			'icon'        => 'dashicons-admin-users',
			'group'       => __( 'Users', 'desktop-mode' ),
			'capability'  => 'promote_users',
			'args_schema' => array(
				'user_id' => array( 'type' => 'integer', 'required' => true ),
				'role'    => array( 'type' => 'string',  'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_user_update_role',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.option.update',
			'label'       => __( 'Set a WordPress option', 'desktop-mode' ),
			'description' => __( 'Update or create a wp_options entry.', 'desktop-mode' ),
			'icon'        => 'dashicons-admin-settings',
			'group'       => __( 'Site', 'desktop-mode' ),
			'capability'  => 'manage_options',
			'args_schema' => array(
				'option' => array( 'type' => 'string', 'required' => true ),
				'value'  => array( 'type' => 'string', 'required' => true ),
			),
			'handler'     => 'wpdm_routine_action_option_update',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.transient.set',
			'label'       => __( 'Set a transient', 'desktop-mode' ),
			'description' => __( 'Cache a value with an expiration.', 'desktop-mode' ),
			'icon'        => 'dashicons-clock',
			'group'       => __( 'Site', 'desktop-mode' ),
			'capability'  => 'manage_options',
			'args_schema' => array(
				'key'        => array( 'type' => 'string',  'required' => true ),
				'value'      => array( 'type' => 'string',  'required' => true ),
				'expiration' => array( 'type' => 'integer', 'description' => 'Seconds until expiry; default 3600.' ),
			),
			'handler'     => 'wpdm_routine_action_transient_set',
		)
	);

	wp_register_desktop_routine_action(
		array(
			'id'          => 'wpdm.broadcast',
			'label'       => __( 'Emit a desktop broadcast topic', 'desktop-mode' ),
			'description' => __( 'Fire a wp-desktop broadcast event so other routines (or windows) can react.', 'desktop-mode' ),
			'icon'        => 'dashicons-megaphone',
			'group'       => __( 'Routines', 'desktop-mode' ),
			'capability'  => 'manage_options',
			'args_schema' => array(
				'topic'   => array( 'type' => 'string', 'required' => true, 'description' => 'e.g. wp-desktop.post.changed' ),
				'payload' => array( 'type' => 'object', 'description' => 'Arbitrary data attached to the broadcast.' ),
			),
			'handler'     => 'wpdm_routine_action_broadcast',
		)
	);
}
add_action( 'init', 'wpdm_routine_register_built_in_actions', 7 );

/**
 * @since 0.22.0
 *
 * @param array $args Action args.
 * @param array $context Run context.
 * @return array|WP_Error
 */
function wpdm_routine_action_comment_trash( $args, $context ) {
	$comment_id = isset( $args['comment_id'] ) ? (int) $args['comment_id'] : 0;
	if ( $comment_id <= 0 ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'comment_id is required.' );
	}
	$ok = wp_trash_comment( $comment_id );
	if ( ! $ok ) {
		return new WP_Error( 'wpdm_routine_action_comment_trash_failed', 'wp_trash_comment returned false.' );
	}
	return array( 'comment_id' => $comment_id, 'trashed' => true );
}

/**
 * @since 0.22.0
 *
 * @param array $args Action args.
 * @param array $context Run context.
 * @return array|WP_Error
 */
function wpdm_routine_action_post_trash( $args, $context ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'post_id is required.' );
	}
	$result = wp_trash_post( $post_id );
	if ( ! $result ) {
		return new WP_Error( 'wpdm_routine_action_post_trash_failed', 'wp_trash_post returned false.' );
	}
	return array( 'post_id' => $post_id, 'trashed' => true );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_post_publish( $args, $context ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'post_id is required.' );
	}
	$updated = wp_update_post(
		array( 'ID' => $post_id, 'post_status' => 'publish' ),
		true
	);
	if ( is_wp_error( $updated ) ) {
		return $updated;
	}
	return array( 'post_id' => $post_id, 'status' => 'publish' );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_post_update_meta( $args, $context ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	$key     = isset( $args['meta_key'] ) ? (string) $args['meta_key'] : '';
	if ( $post_id <= 0 || '' === $key ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'post_id and meta_key are required.' );
	}
	$value = $args['meta_value'] ?? '';
	$ok    = update_post_meta( $post_id, $key, $value );
	return array( 'post_id' => $post_id, 'meta_key' => $key, 'updated' => (bool) $ok );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_post_assign_term( $args, $context ) {
	$post_id  = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	$taxonomy = isset( $args['taxonomy'] ) ? (string) $args['taxonomy'] : '';
	$term     = $args['term'] ?? '';
	if ( $post_id <= 0 || '' === $taxonomy || '' === $term ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'post_id, taxonomy and term are required.' );
	}
	$append  = ! empty( $args['append'] );
	$result  = wp_set_object_terms( $post_id, $term, $taxonomy, $append );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return array( 'post_id' => $post_id, 'taxonomy' => $taxonomy, 'term_taxonomy_ids' => $result );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_comment_approve( $args, $context ) {
	$comment_id = isset( $args['comment_id'] ) ? (int) $args['comment_id'] : 0;
	if ( $comment_id <= 0 ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'comment_id is required.' );
	}
	$ok = wp_set_comment_status( $comment_id, 'approve' );
	if ( ! $ok ) {
		return new WP_Error( 'wpdm_routine_action_comment_approve_failed', 'wp_set_comment_status returned false.' );
	}
	return array( 'comment_id' => $comment_id, 'approved' => true );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_comment_spam( $args, $context ) {
	$comment_id = isset( $args['comment_id'] ) ? (int) $args['comment_id'] : 0;
	if ( $comment_id <= 0 ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'comment_id is required.' );
	}
	$ok = wp_set_comment_status( $comment_id, 'spam' );
	if ( ! $ok ) {
		return new WP_Error( 'wpdm_routine_action_comment_spam_failed', 'wp_set_comment_status returned false.' );
	}
	return array( 'comment_id' => $comment_id, 'spammed' => true );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_user_update_role( $args, $context ) {
	$user_id = isset( $args['user_id'] ) ? (int) $args['user_id'] : 0;
	$role    = isset( $args['role'] ) ? (string) $args['role'] : '';
	if ( $user_id <= 0 || '' === $role ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'user_id and role are required.' );
	}
	$user = get_user_by( 'id', $user_id );
	if ( ! $user ) {
		return new WP_Error( 'wpdm_routine_action_user_not_found', 'User not found.' );
	}
	$user->set_role( $role );
	return array( 'user_id' => $user_id, 'role' => $role );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_option_update( $args, $context ) {
	$option = isset( $args['option'] ) ? (string) $args['option'] : '';
	if ( '' === $option ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'option is required.' );
	}
	$value = $args['value'] ?? '';
	$ok    = update_option( $option, $value );
	return array( 'option' => $option, 'updated' => (bool) $ok );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_transient_set( $args, $context ) {
	$key = isset( $args['key'] ) ? (string) $args['key'] : '';
	if ( '' === $key ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'key is required.' );
	}
	$value      = $args['value'] ?? '';
	$expiration = isset( $args['expiration'] ) ? max( 0, (int) $args['expiration'] ) : HOUR_IN_SECONDS;
	$ok         = set_transient( $key, $value, $expiration );
	return array( 'key' => $key, 'set' => (bool) $ok, 'expiration' => $expiration );
}

/**
 * @since 0.22.0
 */
function wpdm_routine_action_broadcast( $args, $context ) {
	$topic = isset( $args['topic'] ) ? (string) $args['topic'] : '';
	if ( '' === $topic ) {
		return new WP_Error( 'wpdm_routine_action_invalid_args', 'topic is required.' );
	}
	$payload = isset( $args['payload'] ) && is_array( $args['payload'] ) ? $args['payload'] : array();
	/**
	 * The shell's broadcast bridge listens to `wp_desktop_broadcast_received`
	 * and relays the topic + payload to every active window.
	 *
	 * @since 0.22.0
	 *
	 * @param string $topic   Broadcast topic.
	 * @param array  $payload Arbitrary payload.
	 */
	do_action( 'wp_desktop_broadcast_received', $topic, $payload );
	return array( 'topic' => $topic, 'payload' => $payload );
}
