<?php
/**
 * Desktop Mode — Native Comments Window: registration, template, REST fields.
 *
 * Mirrors the structure of the Users/Posts windows adapted for the
 * comment collection — `/wp/v2/comments` rather than `/wp/v2/posts`,
 * a Pending/All/Spam/Trash/Mine tab set, an in-row Reply editor, an
 * Author insights drawer, and a per-row spam confidence score.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Comments window's template body.
 */
function desktop_mode_comments_window_render_template() {
	$can_moderate = current_user_can( 'moderate_comments' );
	ob_start();
	?>
	<div class="desktop-mode-comments desktop-mode-comments--conversation" data-desktop-mode-comments-root>
		<?php /* Tab row filters the thread rail (Pending / All / Spam / Trash / Mine). */ ?>
		<div class="desktop-mode-comments__tabrow" role="tablist" data-desktop-mode-comments-tabs>
			<button type="button" role="tab" class="desktop-mode-comments__tab is-active" data-tab="pending"><?php esc_html_e( 'Pending', 'desktop-mode' ); ?><span class="desktop-mode-comments__tab-count" data-tab-count="pending" hidden></span></button>
			<button type="button" role="tab" class="desktop-mode-comments__tab" data-tab="all"><?php esc_html_e( 'All', 'desktop-mode' ); ?></button>
			<button type="button" role="tab" class="desktop-mode-comments__tab" data-tab="spam"><?php esc_html_e( 'Spam', 'desktop-mode' ); ?></button>
			<button type="button" role="tab" class="desktop-mode-comments__tab" data-tab="trash"><?php esc_html_e( 'Trash', 'desktop-mode' ); ?></button>
			<button type="button" role="tab" class="desktop-mode-comments__tab" data-tab="mine"><?php esc_html_e( 'Mine', 'desktop-mode' ); ?></button>
		</div>

		<div class="desktop-mode-comments__split">
			<?php /* Left rail: search + list of conversations (top-level comments). */ ?>
			<aside class="desktop-mode-comments__rail" aria-label="<?php esc_attr_e( 'Conversations', 'desktop-mode' ); ?>">
				<div class="desktop-mode-comments__search">
					<wpd-text-field data-desktop-mode-comments-search
						placeholder="<?php esc_attr_e( 'Search comments…', 'desktop-mode' ); ?>"></wpd-text-field>
				</div>
				<div class="desktop-mode-comments__list" role="listbox"
					aria-label="<?php esc_attr_e( 'Conversations', 'desktop-mode' ); ?>"
					data-desktop-mode-comments-list></div>
				<div class="desktop-mode-comments__rail-foot" data-desktop-mode-comments-railfoot hidden></div>
			</aside>

			<?php /* Right pane: the selected conversation thread + composer. */ ?>
			<section class="desktop-mode-comments__convo" aria-live="polite"
				data-desktop-mode-comments-convo>
				<div class="desktop-mode-comments__placeholder" data-desktop-mode-comments-placeholder>
					<span class="dashicons dashicons-format-chat" aria-hidden="true"></span>
					<p><?php esc_html_e( 'Select a conversation to read and reply.', 'desktop-mode' ); ?></p>
				</div>
			</section>
		</div>

		<?php /* Realtime "N new" pill — the bundle paints inside this. */ ?>
		<div class="desktop-mode-comments__new-pill" data-desktop-mode-comments-new-pill hidden></div>

		<?php /* Author insights flyover — content + open state owned JS-side.
		         Lives in the DOM permanently so its slide-in transition
		         has something to animate from. The `data-open` attribute
		         drives both the backdrop fade and the panel slide. */ ?>
		<div class="desktop-mode-comments__drawer-backdrop" data-desktop-mode-comments-drawer-backdrop></div>
		<aside class="desktop-mode-comments__drawer" data-desktop-mode-comments-drawer
			role="complementary" aria-label="<?php esc_attr_e( 'Author insights', 'desktop-mode' ); ?>"
			aria-hidden="true">
		</aside>

		<?php if ( $can_moderate ) : ?>
		<div class="desktop-mode-comments__shortcuts" data-desktop-mode-comments-help hidden role="dialog"
			aria-modal="true" aria-labelledby="desktop-mode-comments-help-title">
			<h2 id="desktop-mode-comments-help-title"><?php esc_html_e( 'Keyboard moderation', 'desktop-mode' ); ?></h2>
			<dl>
				<dt>j</dt><dd><?php esc_html_e( 'Next comment', 'desktop-mode' ); ?></dd>
				<dt>k</dt><dd><?php esc_html_e( 'Previous comment', 'desktop-mode' ); ?></dd>
				<dt>a</dt><dd><?php esc_html_e( 'Approve / unapprove', 'desktop-mode' ); ?></dd>
				<dt>s</dt><dd><?php esc_html_e( 'Mark as spam', 'desktop-mode' ); ?></dd>
				<dt>d</dt><dd><?php esc_html_e( 'Move to trash', 'desktop-mode' ); ?></dd>
				<dt>r</dt><dd><?php esc_html_e( 'Reply inline', 'desktop-mode' ); ?></dd>
				<dt>e</dt><dd><?php esc_html_e( 'Edit comment', 'desktop-mode' ); ?></dd>
				<dt>u</dt><dd><?php esc_html_e( 'Undo last action', 'desktop-mode' ); ?></dd>
				<dt>?</dt><dd><?php esc_html_e( 'Toggle this help', 'desktop-mode' ); ?></dd>
			</dl>
			<wpd-button data-desktop-mode-comments-help-close>
				<?php esc_html_e( 'Close', 'desktop-mode' ); ?>
			</wpd-button>
		</div>
		<?php endif; ?>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Comments window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_comments_window_template_html', $html );

	if ( function_exists( 'desktop_mode_kses_native_window_template' ) ) {
		echo desktop_mode_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the native Comments window on `init` (priority 20).
 */
function desktop_mode_comments_window_register_window() {
	if ( ! desktop_mode_comments_window_user_can_register() ) {
		return;
	}

	$viewer_id = (int) get_current_user_id();

	$window_args = array(
		'title'      => __( 'Comments', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-comments',
		'template'   => 'desktop_mode_comments_window_render_template',
		'script'     => 'desktop-mode-comments-window',
		'style'      => 'desktop-mode-comments-window',
		'width'      => 1180,
		'height'     => 760,
		'min_width'  => 760,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			'mode'              => 'comments',
			'introSlug'         => 'comments',
			'restRoot'          => esc_url_raw( rest_url() ),
			'restNonce'         => wp_create_nonce( 'wp_rest' ),
			'commentsUrl'       => esc_url_raw( rest_url( 'wp/v2/comments' ) ),
			'currentUserId'     => $viewer_id,
			'defaultPerPage'    => 20,
			'queryArgs'         => desktop_mode_comments_window_default_query_args(),
			'introSeen'         => desktop_mode_has_seen_intro( $viewer_id, 'comments' ),
			'introUrl'          => esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) ),

			// Capability flags surfaced to the JS — UI hides actions
			// the viewer can't perform. Server still re-checks every
			// mutation, so a tampered flag here changes nothing
			// security-wise.
			'canModerate'       => current_user_can( 'moderate_comments' ),
			'canEditComments'   => current_user_can( 'edit_posts' ),

			// Bulk + helper REST routes — the JS bundle reads these so
			// a rename or namespace move stays in one place.
			'bulkUrl'           => esc_url_raw( rest_url( 'desktop-mode/v1/comments/bulk' ) ),
			'replyUrl'          => esc_url_raw( rest_url( 'desktop-mode/v1/comments/reply' ) ),
			'insightsUrlBase'   => esc_url_raw( rest_url( 'desktop-mode/v1/comments/insights/' ) ),
			'countsUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/comments/counts' ) ),
			'aiSettingsUrl'     => esc_url_raw( rest_url( 'desktop-mode/v1/comments/ai-settings' ) ),
			// Surface the current state so the OS Settings UI + the
			// intro dialog can branch on it without a separate fetch.
			// Cap-gated mirror of what the REST endpoint would return.
			'aiModeration'      => array(
				'enabled'            => desktop_mode_comments_ai_is_enabled(),
				'providerConfigured' => desktop_mode_comments_ai_provider_configured(),
				'canManage'          => current_user_can( 'manage_options' ),
			),

			'replyEditor'       => (string) apply_filters(
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
				'desktop_mode_comments_window_reply_editor',
				'rich',
				$viewer_id
			),
		),
	);

	/**
	 * Filter the args used to register the native Comments window.
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_comments_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-comments', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Native Comments window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'desktop_mode_comments_window_register_window', 20 );

/**
 * Default REST query args for the Comments window.
 *
 * @return array
 */
function desktop_mode_comments_window_default_query_args() {
	// `context=edit` on `wp/v2/comments` requires `moderate_comments`
	// — sending it as an author-without-moderate-cap 401s the entire
	// list. Stick to `view` (every authenticated user can read it) and
	// fall back to the REST `edit` context per-row only when the user
	// opens the inline-edit affordance on a row they're allowed to
	// edit.
	$context = current_user_can( 'moderate_comments' ) ? 'edit' : 'view';
	$args = array(
		'_fields'  =>
			'id,post,parent,author,author_name,author_email,author_url,author_avatar_urls,'
			. 'date,date_gmt,content,link,status,type,'
			. 'desktop_mode_post_title,desktop_mode_post_link,desktop_mode_spam_score,'
			. 'desktop_mode_link_count,desktop_mode_can_edit,desktop_mode_can_moderate,'
			. 'desktop_mode_replies_count,desktop_mode_akismet,desktop_mode_ai_verdict',
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
	return (array) apply_filters( 'desktop_mode_comments_window_query_args', $args );
}

/**
 * Register the Comments-window REST fields on the `comment` resource.
 *
 * Fields are computed lazily — none of them runs unless the bundle
 * explicitly requests them via `_fields`.
 */
function desktop_mode_comments_window_register_rest_fields() {
	register_rest_field(
		'comment',
		'desktop_mode_post_title',
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
		'desktop_mode_post_link',
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
		'desktop_mode_spam_score',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return 0;
				}
				return (int) desktop_mode_comments_window_spam_score( $id );
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
		'desktop_mode_link_count',
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
		'desktop_mode_can_edit',
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
		'desktop_mode_can_moderate',
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
		'desktop_mode_replies_count',
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
		'desktop_mode_ai_verdict',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 || ! function_exists( 'desktop_mode_ai_get_meta' ) ) {
					return null;
				}
				$meta = desktop_mode_ai_get_meta( 'comment', $id );
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
		'desktop_mode_akismet',
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
add_action( 'rest_api_init', 'desktop_mode_comments_window_register_rest_fields' );
