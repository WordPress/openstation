<?php

defined( 'ABSPATH' ) || exit;

function openstation_comments_window_default_query_args() {

	$context = current_user_can( 'moderate_comments' ) ? 'edit' : 'view';
	$args    = array(

		'_fields'  =>
			'id,post,parent,author,author_name,author_avatar_urls,'
			. 'date_gmt,content,status,'
			. 'openstation_post_title,openstation_post_link,'
			. 'openstation_can_edit',
		'context'  => $context,
		'per_page' => 20,

		'status'   => 'hold',
	);

	return (array) apply_filters( 'openstation_comments_window_query_args', $args );
}

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
				return '' === $result ? null : $result;
			},
			'schema'       => $readonly( __( 'Akismet verdict if the plugin is installed (null otherwise).', 'desktop-mode' ), array( 'string', 'null' ) ),
		)
	);
}
add_action( 'rest_api_init', 'openstation_comments_window_register_rest_fields' );
