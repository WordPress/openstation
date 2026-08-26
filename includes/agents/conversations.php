<?php
/**
 * OpenStation — Agents: persisted chat conversations.
 *
 * Each conversation is one post of the private `desktop_mode_chat`
 * post type: `post_author` is the human who held the conversation,
 * the messages live as JSON in `post_content`, the agent's user id in
 * post meta, and the title is derived from the first user message.
 * The posts table is the WordPress-native store for per-user document
 * lists — user meta was rejected because WordPress loads all of a
 * user's meta into cache on any meta read, so fat transcripts would
 * tax every request that touches the user.
 *
 * Access is strictly owner-only: conversations are private
 * correspondence, so not even administrators can read another user's
 * chats through this API.
 *
 * REST surface (all under `desktop-mode/v1`):
 *   GET    /agents/conversations       — the caller's list, newest first
 *   POST   /agents/conversations       — create ({agentId, messages})
 *   GET    /agents/conversations/:id   — one conversation with messages
 *   PUT    /agents/conversations/:id   — replace messages ({messages})
 *   DELETE /agents/conversations/:id   — delete
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Post type holding one conversation per post.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_AGENT_CHAT_POST_TYPE = 'desktop_mode_chat';

/** Newest conversations kept per user — creating past the cap prunes the oldest. */
const OPENSTATION_AGENT_CONVERSATION_CAP = 100;

/** Newest messages kept per conversation — updates past the cap trim the oldest. */
const OPENSTATION_AGENT_CONVERSATION_MESSAGE_CAP = 200;

/** Stored per-message text cap. Wider than the runner's replay cap so long answers reload intact. */
const OPENSTATION_AGENT_CONVERSATION_TEXT_CAP = 20000;

/** Characters of the last message shown as the sidebar's second line. */
const OPENSTATION_AGENT_CONVERSATION_PREVIEW_CAP = 80;

/**
 * Entity kinds a message attachment may reference — mirrors the
 * client's `DroppedEntityKind` and the drag-trigger config enum.
 *
 * @return string[]
 */
function openstation_agent_conversation_attachment_kinds() {
	return array( 'post', 'page', 'media', 'user', 'comment' );
}

/**
 * Register the conversation post type. Private plumbing: no admin UI,
 * no front-end queries, no revisions; rows die with their author.
 *
 * @return void
 */
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

/**
 * Normalize caller-supplied messages for storage.
 *
 * Rows: `role` in user|agent|error, non-empty `text` (capped), `at`
 * timestamp. Tool calls keep name/args/error for the transcript
 * display but DROP `output` — tool outputs can embed entire post
 * bodies and are never rendered.
 *
 * An `attachment` block survives too: the entity a drop or a "Send
 * to" pick carried into the conversation, so a reopened transcript
 * still renders the clickable object card instead of only the
 * boilerplate sentence the model was handed.
 *
 * @param mixed $messages Incoming message rows.
 * @return array<int, array<string, mixed>>
 */
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

		// Call-to-action buttons survive with the message so a reopened
		// conversation still shows them (spent ones stay disabled via
		// `ctaUsed`). Reuses the runner's sanitizer — same caps.
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

/**
 * Normalize one message attachment, or null when the block does not
 * describe an entity this site understands.
 *
 * Only the identity triple is stored — kind, id, title. The client
 * resolves the object's URL at click time from the kind, so a
 * renamed or re-permalinked entity never leaves a stale link behind
 * in an old transcript.
 *
 * @param mixed $raw Incoming attachment block.
 * @return array<string, mixed>|null
 */
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

/**
 * Derive a list title from the first user message.
 *
 * @param array $messages Sanitized messages.
 * @return string
 */
function openstation_agent_conversation_title( array $messages ) {
	foreach ( $messages as $row ) {
		if ( 'user' === $row['role'] ) {
			return wp_html_excerpt( $row['text'], 60, '…' );
		}
	}
	return __( 'Conversation', 'desktop-mode' );
}

/**
 * The sidebar's second line: the TAIL of the last message.
 *
 * The title is derived from the FIRST user message, which makes every
 * conversation with the same opener look identical in the list. The
 * preview answers the other question — "where did this one get to?" —
 * so it reads from the end ("…and search relevance.") rather than the
 * beginning. An attachment-carrying row previews the object instead of
 * the boilerplate sentence the model was handed.
 *
 * @param array $messages Sanitized messages.
 * @return string
 */
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

/**
 * The conversation post for `$id` when it exists AND belongs to the
 * current user; null otherwise. Ownership is the whole access model.
 *
 * @param int $id Post id.
 * @return WP_Post|null
 */
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

/**
 * Project a conversation post onto the REST shape. The agent block is
 * resolved live so the sidebar can paint the avatar + reopen the chat
 * header; a deleted agent degrades to a labelled placeholder.
 *
 * @param WP_Post $post          Conversation post.
 * @param bool    $with_messages Include the decoded messages array.
 * @return array<string, mixed>
 */
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
		'agentName'        => $agent ? $agent->display_name : __( 'Deleted agent', 'desktop-mode' ),
		'agentDescription' => $agent ? (string) get_user_meta( $agent_id, '_desktop_mode_agent_description', true ) : '',
		'agentAvatarUrl'   => function_exists( 'openstation_agent_avatar_url' ) ? openstation_agent_avatar_url( $agent_id ) : '',
		'title'            => (string) $post->post_title,
		// Second sidebar line + who spoke last, so the list can say
		// where each conversation got to instead of repeating its opener.
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

/**
 * Register the conversation routes.
 *
 * Invoke-level permission gates the surface (anyone who can talk to
 * agents can keep their own history); ownership checks inside each
 * handler scope every read and write to the caller's rows.
 *
 * @return void
 */
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

/**
 * GET /agents/conversations — the caller's conversations, most
 * recently updated first, without message bodies (the list must stay
 * light; the sidebar fetches bodies on click).
 *
 * @return WP_REST_Response
 */
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

/**
 * POST /agents/conversations — create from {agentId, messages}.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
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

	$post_id = wp_insert_post(
		array(
			'post_type'    => OPENSTATION_AGENT_CHAT_POST_TYPE,
			'post_status'  => 'publish',
			'post_author'  => get_current_user_id(),
			'post_title'   => openstation_agent_conversation_title( $messages ),
			// JSON survives the insert-path unslashing only when slashed.
			'post_content' => wp_slash( (string) wp_json_encode( $messages ) ),
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}
	update_post_meta( $post_id, '_desktop_mode_agent_chat_agent_id', $agent_id );

	openstation_agent_conversations_prune( get_current_user_id() );

	return rest_ensure_response(
		openstation_agent_conversation_prepare( get_post( $post_id ), true )
	);
}

/**
 * GET /agents/conversations/:id — one conversation with messages.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_agents_rest_conversations_get( WP_REST_Request $request ) {
	$post = openstation_agent_conversation_get_own( (int) $request['id'] );
	if ( ! $post ) {
		return openstation_agent_conversation_not_found();
	}
	return rest_ensure_response(
		openstation_agent_conversation_prepare( $post, true )
	);
}

/**
 * PUT /agents/conversations/:id — replace the messages. The client
 * owns the in-memory transcript, so full replacement after each
 * exchange is simpler and idempotent compared to append semantics.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
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

	$updated = wp_update_post(
		array(
			'ID'           => $post->ID,
			'post_title'   => openstation_agent_conversation_title( $messages ),
			'post_content' => wp_slash( (string) wp_json_encode( $messages ) ),
		),
		true
	);
	if ( is_wp_error( $updated ) ) {
		return $updated;
	}

	return rest_ensure_response(
		openstation_agent_conversation_prepare( get_post( $post->ID ), true )
	);
}

/**
 * DELETE /agents/conversations/:id.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_agents_rest_conversations_delete( WP_REST_Request $request ) {
	$post = openstation_agent_conversation_get_own( (int) $request['id'] );
	if ( ! $post ) {
		return openstation_agent_conversation_not_found();
	}
	wp_delete_post( $post->ID, true );
	return rest_ensure_response( array( 'deleted' => true ) );
}

/**
 * Shared 404 for missing/foreign conversations — the same error for
 * "does not exist" and "not yours" so ids can't be probed.
 *
 * @return WP_Error
 */
function openstation_agent_conversation_not_found() {
	return new WP_Error(
		'openstation_agent_conversation_not_found',
		__( 'No conversation with that id exists.', 'desktop-mode' ),
		array( 'status' => 404 )
	);
}

/**
 * The effective per-user conversation cap.
 *
 * @return int
 */
function openstation_agent_conversation_cap() {
	/**
	 * Filters how many conversations are kept per user. Creating past
	 * the cap prunes the least recently updated rows.
	 *
	 * @param int $cap Maximum stored conversations per user.
	 */
	return max( 1, (int) apply_filters( 'openstation_agent_conversation_cap', OPENSTATION_AGENT_CONVERSATION_CAP ) );
}

/**
 * Drop the user's oldest conversations beyond the cap.
 *
 * @param int $user_id Owner.
 * @return void
 */
function openstation_agent_conversations_prune( $user_id ) {
	$cap   = openstation_agent_conversation_cap();
	$posts = get_posts(
		array(
			'post_type'        => OPENSTATION_AGENT_CHAT_POST_TYPE,
			'post_status'      => 'publish',
			'author'           => (int) $user_id,
			// One page past the cap is plenty — pruning runs on every create.
			'numberposts'      => $cap + 10,
			// The ID tie-break matters: same-second rows are otherwise
			// unordered and the prune could eat the row just created.
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
