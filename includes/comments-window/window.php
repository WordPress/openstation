<?php
/**
 * OpenStation — Native Comments Window: registration, template, REST fields.
 *
 * Mirrors the structure of the Users/Posts windows adapted for the
 * comment collection — `/wp/v2/comments` rather than `/wp/v2/posts`.
 * The surface is a two-pane conversation view: a Pending/All/Spam/
 * Trash/Mine tab set over a rail of conversations, and the selected
 * thread's full nested reply chain with a docked composer.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Comments window's template body.
 */
function openstation_comments_window_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-comments os-comments--conversation" data-os-comments-root>
		<?php
		/*
		 * Tab strip filters the thread rail (Pending / All / Spam /
		 * Trash / Mine). `<os-tabs>` owns roving `tabindex` and the
		 * `aria-selected` mirror; the bundle only listens for
		 * `os-tab-change`. There are no `<os-tabpanel>` siblings —
		 * one pane is repainted in place rather than swapped.
		 */
		?>
		<os-tabs class="os-comments__tabrow" value="pending"
			label="<?php esc_attr_e( 'Comment status', 'desktop-mode' ); ?>"
			data-os-comments-tabs>
			<os-tab value="pending"><?php esc_html_e( 'Pending', 'desktop-mode' ); ?></os-tab>
			<os-tab value="all"><?php esc_html_e( 'All', 'desktop-mode' ); ?></os-tab>
			<os-tab value="spam"><?php esc_html_e( 'Spam', 'desktop-mode' ); ?></os-tab>
			<os-tab value="trash"><?php esc_html_e( 'Trash', 'desktop-mode' ); ?></os-tab>
			<os-tab value="mine"><?php esc_html_e( 'Mine', 'desktop-mode' ); ?></os-tab>
		</os-tabs>

		<div class="os-comments__split">
			<?php /* Left rail: search + list of conversations (top-level comments). */ ?>
			<aside class="os-comments__rail" aria-label="<?php esc_attr_e( 'Conversations', 'desktop-mode' ); ?>">
				<div class="os-comments__search">
					<os-text-field data-os-comments-search
						placeholder="<?php esc_attr_e( 'Search comments…', 'desktop-mode' ); ?>"></os-text-field>
				</div>
				<div class="os-comments__list" role="list"
					aria-label="<?php esc_attr_e( 'Conversations', 'desktop-mode' ); ?>"
					data-os-comments-list></div>
			</aside>

			<?php
			/*
			 * Right pane: the selected conversation thread + composer.
			 * Deliberately NOT a live region — the whole pane is
			 * replaced on every selection and after every moderation
			 * action, so announcing it would read the entire thread
			 * aloud each time. The small status node below carries the
			 * announcements instead.
			 */
			?>
			<section class="os-comments__convo" data-os-comments-convo></section>
		</div>

		<?php /* Single polite live region for action results ("Approved", "Reply sent"). */ ?>
		<div class="os-comments__status screen-reader-text" role="status" aria-live="polite"
			data-os-comments-status></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Comments window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_comments_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the native Comments window on `init` (priority 20).
 */
function openstation_comments_window_register_window() {
	if ( ! openstation_comments_window_user_can_register() ) {
		return;
	}

	$viewer_id = (int) get_current_user_id();

	$window_args = array(
		'title'      => __( 'Comments', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-comments',
		'template'   => 'openstation_comments_window_render_template',
		'script'     => 'os-comments-window',
		'style'      => 'os-comments-window',
		'width'      => 1180,
		'height'     => 760,
		'min_width'  => 760,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			'mode'            => 'comments',
			'introSlug'       => 'comments',
			'restRoot'        => esc_url_raw( rest_url() ),
			'restNonce'       => wp_create_nonce( 'wp_rest' ),
			'commentsUrl'     => esc_url_raw( rest_url( 'wp/v2/comments' ) ),
			'currentUserId'   => $viewer_id,
			'defaultPerPage'  => 20,
			'queryArgs'       => openstation_comments_window_default_query_args(),
			'introSeen'       => openstation_has_seen_intro( $viewer_id, 'comments' ),
			'introUrl'        => esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) ),

			// Capability flags surfaced to the JS — UI hides actions
			// the viewer can't perform. Server still re-checks every
			// mutation, so a tampered flag here changes nothing
			// security-wise.
			'canModerate'     => current_user_can( 'moderate_comments' ),
			'canEditComments' => current_user_can( 'edit_posts' ),

			// Bulk + helper REST routes — the JS bundle reads these so
			// a rename or namespace move stays in one place.
			'bulkUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/comments/bulk' ) ),
			'replyUrl'        => esc_url_raw( rest_url( 'desktop-mode/v1/comments/reply' ) ),
			'insightsUrlBase' => esc_url_raw( rest_url( 'desktop-mode/v1/comments/insights/' ) ),
			'countsUrl'       => esc_url_raw( rest_url( 'desktop-mode/v1/comments/counts' ) ),
			'aiSettingsUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/comments/ai-settings' ) ),
			// Surface the current state so the OS Settings UI + the
			// intro dialog can branch on it without a separate fetch.
			// Cap-gated mirror of what the REST endpoint would return.
			'aiModeration'    => array(
				'enabled'            => openstation_comments_ai_is_enabled(),
				'providerConfigured' => openstation_comments_ai_provider_configured(),
				'canManage'          => current_user_can( 'manage_options' ),
			),

			'replyEditor'     => (string) apply_filters(
				/**
				 * Filter the reply editor implementation the bundle should mount.
				 *
				 * - `'rich'`      — built-in contenteditable rich editor (default).
				 * - `'gutenberg'` — full @wordpress/block-editor (follow-up surface).
				 * - `'plain'`     — plain textarea, no toolbar.
				 *
				 * @param string $editor   Editor flavor slug.
				 * @param int    $viewer_id Current user id.
				 */
				'openstation_comments_window_reply_editor',
				'rich',
				$viewer_id
			),
		),
	);

	/**
	 * Filter the args used to register the native Comments window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_comments_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-comments', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Native Comments window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_comments_window_register_window', 20 );

/**
 * Default REST query args for the Comments window.
 *
 * @return array
 */
function openstation_comments_window_default_query_args() {
	// `context=edit` on `wp/v2/comments` requires `moderate_comments`
	// — sending it as an author-without-moderate-cap 401s the entire
	// list. Stick to `view` (every authenticated user can read it) and
	// fall back to the REST `edit` context per-row only when the user
	// opens the inline-edit affordance on a row they're allowed to
	// edit.
	$context = current_user_can( 'moderate_comments' ) ? 'edit' : 'view';
	$args    = array(

		/*
		 * Exactly the fields the conversation view renders — no more.
		 * Every `openstation_*` field is a computed REST field, and
		 * `openstation_replies_count` runs its own `get_comments()`
		 * COUNT per row, so an over-broad `_fields` is a per-row query
		 * multiplier. The scoring fields (`spam_score`, `link_count`,
		 * `akismet`, `ai_verdict`) are NOT requested here: nothing in
		 * the conversation UI reads them, and computing them costs a
		 * meta read (or worse) per row. Re-add them via the filter
		 * below if a plugin surfaces them.
		 */
		'_fields'  =>
			'id,post,parent,author,author_name,author_avatar_urls,'
			. 'date_gmt,content,status,'
			. 'openstation_post_title,openstation_post_link,'
			. 'openstation_can_edit,openstation_can_moderate,'
			. 'openstation_replies_count',
		'context'  => $context,
		'per_page' => 20,
		// 'hold' = pending. Use the wp/v2 status names where they differ
		// from core's: 'hold' / 'approve' / 'spam' / 'trash'.
		'status'   => 'hold',
	);

	/**
	 * Filter the default outbound REST query args for the Comments window.
	 *
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'openstation_comments_window_query_args', $args );
}

/**
 * Register the Comments-window REST fields on the `comment` resource.
 *
 * Fields are computed lazily — none of them runs unless the bundle
 * explicitly requests them via `_fields`.
 */
function openstation_comments_window_register_rest_fields() {
	register_rest_field(
		'comment',
		'openstation_post_title',
		array(
			'get_callback' => static function ( $row ) {
				$post_id = isset( $row['post'] ) ? (int) $row['post'] : 0;
				if ( $post_id <= 0 ) {
					return '';
				}
				$post = get_post( $post_id );
				return $post ? (string) get_the_title( $post ) : '';
			},
			'schema'       => array(
				'description' => __( 'Title of the post the comment is attached to.', 'desktop-mode' ),
				'type'        => 'string',
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_post_link',
		array(
			'get_callback' => static function ( $row ) {
				$post_id = isset( $row['post'] ) ? (int) $row['post'] : 0;
				if ( $post_id <= 0 ) {
					return '';
				}
				return (string) get_permalink( $post_id );
			},
			'schema'       => array(
				'description' => __( 'Permalink of the post the comment is attached to.', 'desktop-mode' ),
				'type'        => 'string',
				'format'      => 'uri',
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_spam_score',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return 0;
				}
				return (int) openstation_comments_window_spam_score( $id );
			},
			'schema'       => array(
				'description' => __( 'Spam confidence score, 0–100.', 'desktop-mode' ),
				'type'        => 'integer',
				'minimum'     => 0,
				'maximum'     => 100,
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_link_count',
		array(
			'get_callback' => static function ( $row ) {
				$content = isset( $row['content']['raw'] )
					? (string) $row['content']['raw']
					: ( isset( $row['content']['rendered'] ) ? (string) $row['content']['rendered'] : '' );
				return (int) preg_match_all( '#https?://#i', $content );
			},
			'schema'       => array(
				'description' => __( 'Number of links in the comment.', 'desktop-mode' ),
				'type'        => 'integer',
				'minimum'     => 0,
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_can_edit',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				return $id > 0 && current_user_can( 'edit_comment', $id );
			},
			'schema'       => array(
				'description' => __( 'Whether the requester can edit this comment.', 'desktop-mode' ),
				'type'        => 'boolean',
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_can_moderate',
		array(
			'get_callback' => static function () {
				return current_user_can( 'moderate_comments' );
			},
			'schema'       => array(
				'description' => __( 'Whether the requester can moderate comments globally.', 'desktop-mode' ),
				'type'        => 'boolean',
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_replies_count',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return 0;
				}
				return (int) get_comments(
					array(
						'parent' => $id,
						'count'  => true,
						'status' => 'all',
					)
				);
			},
			'schema'       => array(
				'description' => __( 'Direct-reply count for this comment.', 'desktop-mode' ),
				'type'        => 'integer',
				'minimum'     => 0,
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_ai_verdict',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 || ! function_exists( 'openstation_ai_get_meta' ) ) {
					return null;
				}
				$meta = openstation_ai_get_meta( 'comment', $id );
				if ( ! is_array( $meta ) ) {
					return null;
				}
				return array(
					'spam'       => ! empty( $meta['spam'] ),
					'harmful'    => ! empty( $meta['harmful'] ),
					'topic'      => isset( $meta['topic'] ) ? (string) $meta['topic'] : '',
					'summary'    => isset( $meta['ai_summary'] ) ? (string) $meta['ai_summary'] : '',
					'analyzedAt' => isset( $meta['analyzed_at'] ) ? (int) $meta['analyzed_at'] : 0,
				);
			},
			'schema'       => array(
				'description' => __( 'AI moderation verdict for this comment, when analyzed (null otherwise).', 'desktop-mode' ),
				'type'        => array( 'object', 'null' ),
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'comment',
		'openstation_akismet',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return null;
				}
				$result = (string) get_comment_meta( $id, 'akismet_result', true );
				if ( '' === $result ) {
					return null;
				}
				return $result; // 'true' | 'false' | 'pending'.
			},
			'schema'       => array(
				'description' => __( 'Akismet verdict if the plugin is installed (null otherwise).', 'desktop-mode' ),
				'type'        => array( 'string', 'null' ),
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_comments_window_register_rest_fields' );
