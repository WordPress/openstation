<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AGENT_CHAT_POST_TYPE = 'desktop_mode_chat';

const OPENSTATION_AGENT_CONVERSATION_CAP = 100;

const OPENSTATION_AGENT_CONVERSATION_MESSAGE_CAP = 200;

const OPENSTATION_AGENT_CONVERSATION_TEXT_CAP = 20000;

const OPENSTATION_AGENT_CONVERSATION_PREVIEW_CAP = 80;

function openstation_agent_conversation_attachment_kinds() {
	return array( 'post', 'page', 'media', 'user', 'comment' );
}

function openstation_agent_conversations_register_post_type() {
	register_post_type(
		OPENSTATION_AGENT_CHAT_POST_TYPE,
		array(
			'label'               => __( 'Agent conversations', 'desktop-mode' ),
			'public'              => false,
			'show_ui'             => false,
			'show_in_rest'        => false,
			'exclude_from_search' => true,
			'publicly_queryable'  => false,
			'rewrite'             => false,
			'query_var'           => false,
			'supports'            => array( 'title', 'author' ),
			'delete_with_user'    => true,
		)
	);
}
add_action( 'init', 'openstation_agent_conversations_register_post_type', 5 );

function openstation_agent_conversation_sanitize_messages( $messages ) {
	if ( ! is_array( $messages ) ) {
		return array();
	}

	$clean = array();
	foreach ( $messages as $row ) {
		if ( ! is_array( $row ) ) {
			continue;
		}
		$role = isset( $row['role'] ) ? sanitize_key( (string) $row['role'] ) : '';
		if ( ! in_array( $role, array( 'user', 'agent', 'error' ), true ) ) {
			continue;
		}
		$text = isset( $row['text'] ) ? trim( (string) $row['text'] ) : '';
		if ( '' === $text ) {
			continue;
		}

		$entry = array(
			'role' => $role,
			'text' => mb_substr( $text, 0, OPENSTATION_AGENT_CONVERSATION_TEXT_CAP ),
			'at'   => isset( $row['at'] ) ? (int) $row['at'] : 0,
		);

		if ( isset( $row['callToActions'] ) && function_exists( 'openstation_agent_sanitize_call_to_actions' ) ) {
			$ctas = openstation_agent_sanitize_call_to_actions( $row['callToActions'] );
			if ( ! empty( $ctas ) ) {
				$entry['callToActions'] = $ctas;
			}
		}
		if ( ! empty( $row['ctaUsed'] ) ) {
			$entry['ctaUsed'] = true;
		}

		if ( isset( $row['attachment'] ) ) {
			$attachment = openstation_agent_conversation_sanitize_attachment( $row['attachment'] );
			if ( null !== $attachment ) {
				$entry['attachment'] = $attachment;
			}
		}

		if ( isset( $row['toolCalls'] ) && is_array( $row['toolCalls'] ) ) {
			$calls = array();
			foreach ( $row['toolCalls'] as $call ) {
				if ( ! is_array( $call ) ) {
					continue;
				}
				$calls[] = array(
					'callId' => isset( $call['callId'] ) ? (string) $call['callId'] : '',
					'name'   => isset( $call['name'] ) ? (string) $call['name'] : '',
					'args'   => isset( $call['args'] ) && is_array( $call['args'] ) ? $call['args'] : array(),
					'error'  => isset( $call['error'] ) && is_string( $call['error'] ) ? $call['error'] : null,
				);
			}
			if ( ! empty( $calls ) ) {
				$entry['toolCalls'] = $calls;
			}
		}

		$clean[] = $entry;
	}

	if ( count( $clean ) > OPENSTATION_AGENT_CONVERSATION_MESSAGE_CAP ) {
		$clean = array_slice( $clean, -OPENSTATION_AGENT_CONVERSATION_MESSAGE_CAP );
	}

	return $clean;
}

function openstation_agent_conversation_sanitize_attachment( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}
	$kind = isset( $raw['kind'] ) ? sanitize_key( (string) $raw['kind'] ) : '';
	$id   = isset( $raw['id'] ) ? (int) $raw['id'] : 0;
	if ( $id <= 0 || ! in_array( $kind, openstation_agent_conversation_attachment_kinds(), true ) ) {
		return null;
	}
	$title = isset( $raw['title'] ) ? trim( wp_strip_all_tags( (string) $raw['title'] ) ) : '';
	return array(
		'kind'  => $kind,
		'id'    => $id,
		'title' => '' !== $title ? mb_substr( $title, 0, 200 ) : '#' . $id,
	);
}

function openstation_agent_conversation_title( array $messages ) {
	foreach ( $messages as $row ) {
		if ( 'user' === $row['role'] ) {
			return wp_html_excerpt( $row['text'], 60, '…' );
		}
	}
	return __( 'Conversation', 'desktop-mode' );
}

function openstation_agent_conversation_preview( array $messages ) {
	$last = empty( $messages ) ? null : $messages[ count( $messages ) - 1 ];
	if ( ! is_array( $last ) ) {
		return '';
	}
	if ( isset( $last['attachment']['title'] ) ) {
		return (string) $last['attachment']['title'];
	}

	$text = trim( (string) preg_replace( '/\s+/u', ' ', wp_strip_all_tags( (string) $last['text'] ) ) );
	if ( '' === $text ) {
		return '';
	}
	if ( mb_strlen( $text ) <= OPENSTATION_AGENT_CONVERSATION_PREVIEW_CAP ) {
		return $text;
	}
	return '…' . mb_substr( $text, -OPENSTATION_AGENT_CONVERSATION_PREVIEW_CAP );
}

function openstation_agent_conversation_get_own( $id ) {
	$post = get_post( (int) $id );
	if ( ! $post || OPENSTATION_AGENT_CHAT_POST_TYPE !== $post->post_type ) {
		return null;
	}
	if ( get_current_user_id() !== (int) $post->post_author ) {
		return null;
	}
	return $post;
}

function openstation_agent_conversation_prepare( WP_Post $post, $with_messages = false ) {
	$agent_id = (int) get_post_meta( $post->ID, '_desktop_mode_agent_chat_agent_id', true );
	$agent    = $agent_id > 0 ? get_userdata( $agent_id ) : false;

	$messages = json_decode( (string) $post->post_content, true );
	if ( ! is_array( $messages ) ) {
		$messages = array();
	}

	$last = empty( $messages ) ? null : $messages[ count( $messages ) - 1 ];

	$out = array(
		'id'               => (int) $post->ID,
		'agentId'          => $agent_id,
		'agentName'        => $agent ? openstation_plain_text_title( $agent->display_name ) : __( 'Deleted agent', 'desktop-mode' ),
		'agentDescription' => $agent ? (string) get_user_meta( $agent_id, '_desktop_mode_agent_description', true ) : '',
		'agentAvatarUrl'   => function_exists( 'openstation_agent_avatar_url' ) ? openstation_agent_avatar_url( $agent_id ) : '',
		'title'            => (string) $post->post_title,

		'preview'          => openstation_agent_conversation_preview( $messages ),
		'lastRole'         => is_array( $last ) && isset( $last['role'] ) ? (string) $last['role'] : '',
		'messageCount'     => count( $messages ),
		'createdAt'        => mysql2date( 'c', $post->post_date_gmt, false ),
		'updatedAt'        => mysql2date( 'c', $post->post_modified_gmt, false ),
	);
	if ( $with_messages ) {
		$out['messages'] = $messages;
	}
	return $out;
}

function openstation_agent_conversations_register_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/agents/conversations',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_agents_rest_conversations_list',
				'permission_callback' => 'openstation_agents_rest_invoke_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_agents_rest_conversations_create',
				'permission_callback' => 'openstation_agents_rest_invoke_permission',
				'args'                => array(
					'agentId'  => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 1,
					),
					'messages' => array(
						'type'     => 'array',
						'required' => true,
					),
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/agents/conversations/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_agents_rest_conversations_get',
				'permission_callback' => 'openstation_agents_rest_invoke_permission',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'openstation_agents_rest_conversations_update',
				'permission_callback' => 'openstation_agents_rest_invoke_permission',
				'args'                => array(
					'messages' => array(
						'type'     => 'array',
						'required' => true,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'openstation_agents_rest_conversations_delete',
				'permission_callback' => 'openstation_agents_rest_invoke_permission',
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_agent_conversations_register_routes' );

function openstation_agents_rest_conversations_list() {
	$posts = get_posts(
		array(
			'post_type'        => OPENSTATION_AGENT_CHAT_POST_TYPE,
			'post_status'      => 'publish',
			'author'           => get_current_user_id(),
			'numberposts'      => openstation_agent_conversation_cap(),
			'orderby'          => 'modified',
			'order'            => 'DESC',
			'suppress_filters' => false,
		)
	);

	return rest_ensure_response(
		array_map( 'openstation_agent_conversation_prepare', $posts )
	);
}

function openstation_agent_conversation_preserve_text( $data, $postarr, $unsanitized_postarr ) {
	global $wpdb;

	if ( OPENSTATION_AGENT_CHAT_POST_TYPE !== $data['post_type'] ) {
		return $data;
	}
	foreach ( array( 'post_title', 'post_content' ) as $field ) {
		if ( ! isset( $unsanitized_postarr[ $field ] ) ) {
			continue;
		}
		$data[ $field ] = $unsanitized_postarr[ $field ];

		if ( in_array( $wpdb->get_col_charset( $wpdb->posts, $field ), array( 'utf8', 'utf8mb3' ), true ) ) {
			$data[ $field ] = wp_encode_emoji( $data[ $field ] );
		}
	}
	return $data;
}

function openstation_agents_rest_conversations_create( WP_REST_Request $request ) {
	$agent_id = (int) $request['agentId'];
	if ( ! function_exists( 'openstation_agent_is_agent' ) || ! openstation_agent_is_agent( $agent_id ) ) {
		return new WP_Error(
			'openstation_agent_not_found',
			__( 'No agent with that id exists.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$messages = openstation_agent_conversation_sanitize_messages( $request['messages'] );
	if ( empty( $messages ) ) {
		return new WP_Error(
			'openstation_agent_conversation_empty',
			__( 'A conversation needs at least one message.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	add_filter( 'wp_insert_post_data', 'openstation_agent_conversation_preserve_text', 5, 3 );
	$post_id = wp_insert_post(
		array(
			'post_type'    => OPENSTATION_AGENT_CHAT_POST_TYPE,
			'post_status'  => 'publish',
			'post_author'  => get_current_user_id(),

			'post_title'   => wp_slash( openstation_agent_conversation_title( $messages ) ),
			'post_content' => wp_slash( (string) wp_json_encode( $messages ) ),
		),
		true
	);
	remove_filter( 'wp_insert_post_data', 'openstation_agent_conversation_preserve_text', 5 );
	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}
	update_post_meta( $post_id, '_desktop_mode_agent_chat_agent_id', $agent_id );

	openstation_agent_conversations_prune( get_current_user_id() );

	return rest_ensure_response(
		openstation_agent_conversation_prepare( get_post( $post_id ), true )
	);
}

function openstation_agents_rest_conversations_get( WP_REST_Request $request ) {
	$post = openstation_agent_conversation_get_own( (int) $request['id'] );
	if ( ! $post ) {
		return openstation_agent_conversation_not_found();
	}
	return rest_ensure_response(
		openstation_agent_conversation_prepare( $post, true )
	);
}

function openstation_agents_rest_conversations_update( WP_REST_Request $request ) {
	$post = openstation_agent_conversation_get_own( (int) $request['id'] );
	if ( ! $post ) {
		return openstation_agent_conversation_not_found();
	}

	$messages = openstation_agent_conversation_sanitize_messages( $request['messages'] );
	if ( empty( $messages ) ) {
		return new WP_Error(
			'openstation_agent_conversation_empty',
			__( 'A conversation needs at least one message.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	add_filter( 'wp_insert_post_data', 'openstation_agent_conversation_preserve_text', 5, 3 );
	$updated = wp_update_post(
		array(
			'ID'           => $post->ID,
			'post_title'   => wp_slash( openstation_agent_conversation_title( $messages ) ),
			'post_content' => wp_slash( (string) wp_json_encode( $messages ) ),
		),
		true
	);
	remove_filter( 'wp_insert_post_data', 'openstation_agent_conversation_preserve_text', 5 );
	if ( is_wp_error( $updated ) ) {
		return $updated;
	}

	return rest_ensure_response(
		openstation_agent_conversation_prepare( get_post( $post->ID ), true )
	);
}

function openstation_agents_rest_conversations_delete( WP_REST_Request $request ) {
	$post = openstation_agent_conversation_get_own( (int) $request['id'] );
	if ( ! $post ) {
		return openstation_agent_conversation_not_found();
	}
	wp_delete_post( $post->ID, true );
	return rest_ensure_response( array( 'deleted' => true ) );
}

function openstation_agent_conversation_not_found() {
	return new WP_Error(
		'openstation_agent_conversation_not_found',
		__( 'No conversation with that id exists.', 'desktop-mode' ),
		array( 'status' => 404 )
	);
}

function openstation_agent_conversation_cap() {

	return max( 1, (int) apply_filters( 'openstation_agent_conversation_cap', OPENSTATION_AGENT_CONVERSATION_CAP ) );
}

function openstation_agent_conversations_prune( $user_id ) {
	$cap   = openstation_agent_conversation_cap();
	$posts = get_posts(
		array(
			'post_type'        => OPENSTATION_AGENT_CHAT_POST_TYPE,
			'post_status'      => 'publish',
			'author'           => (int) $user_id,

			'numberposts'      => $cap + 10,

			'orderby'          => array(
				'modified' => 'DESC',
				'ID'       => 'DESC',
			),
			'fields'           => 'ids',
			'suppress_filters' => false,
		)
	);
	foreach ( array_slice( $posts, $cap ) as $stale_id ) {
		wp_delete_post( (int) $stale_id, true );
	}
}
