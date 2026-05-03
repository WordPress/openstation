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
