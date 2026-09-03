<?php
/**
 * Comments app — the `wp/v2/comments` projection.
 *
 * The default query args the app's `data()` sends to the comments
 * collection (filterable through `openstation_comments_window_query_args`,
 * so a plugin can widen `_fields` or scope the default view), and the
 * computed `openstation_*` REST fields on the `comment` resource the
 * conversation view reads. Fields are computed lazily — none of them
 * runs unless a request asks for it via `_fields`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default REST query args for the Comments app.
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
 * Register the app's REST fields on the `comment` resource.
 */
function openstation_comments_window_register_rest_fields() {
	$readonly = static function ( $description, $type, array $extra = array() ) {
		return array_merge(
			array(
				'description' => $description,
				'type'        => $type,
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
			$extra
		);
	};

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
			'schema'       => $readonly( __( 'Title of the post the comment is attached to.', 'desktop-mode' ), 'string' ),
		)
	);

	register_rest_field(
		'comment',
		'openstation_post_link',
		array(
			'get_callback' => static function ( $row ) {
				$post_id = isset( $row['post'] ) ? (int) $row['post'] : 0;
				return $post_id > 0 ? (string) get_permalink( $post_id ) : '';
			},
			'schema'       => $readonly( __( 'Permalink of the post the comment is attached to.', 'desktop-mode' ), 'string', array( 'format' => 'uri' ) ),
		)
	);

	register_rest_field(
		'comment',
		'openstation_spam_score',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				return $id > 0 ? (int) openstation_comments_window_spam_score( $id ) : 0;
			},
			'schema'       => $readonly(
				__( 'Spam confidence score, 0–100.', 'desktop-mode' ),
				'integer',
				array(
					'minimum' => 0,
					'maximum' => 100,
				)
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
			'schema'       => $readonly( __( 'Number of links in the comment.', 'desktop-mode' ), 'integer', array( 'minimum' => 0 ) ),
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
			'schema'       => $readonly( __( 'Whether the requester can edit this comment.', 'desktop-mode' ), 'boolean' ),
		)
	);

	register_rest_field(
		'comment',
		'openstation_can_moderate',
		array(
			'get_callback' => static function () {
				return current_user_can( 'moderate_comments' );
			},
			'schema'       => $readonly( __( 'Whether the requester can moderate comments globally.', 'desktop-mode' ), 'boolean' ),
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
			'schema'       => $readonly( __( 'Direct-reply count for this comment.', 'desktop-mode' ), 'integer', array( 'minimum' => 0 ) ),
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
			'schema'       => $readonly( __( 'AI moderation verdict for this comment, when analyzed (null otherwise).', 'desktop-mode' ), array( 'object', 'null' ) ),
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
				return '' === $result ? null : $result; // 'true' | 'false' | 'pending'.
			},
			'schema'       => $readonly( __( 'Akismet verdict if the plugin is installed (null otherwise).', 'desktop-mode' ), array( 'string', 'null' ) ),
		)
	);
}
add_action( 'rest_api_init', 'openstation_comments_window_register_rest_fields' );
