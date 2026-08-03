<?php
/**
 * Tests for persisted agent chat conversations — sanitization, CRUD
 * round-trips, strict ownership, and the caps. Handlers are invoked
 * directly (the house pattern) with `WP_REST_Request` objects.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsConversations extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $agent_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );

		wp_set_current_user( self::$admin_id );
		$agent = open_station_agent_create(
			array(
				'name'         => 'Conversation Agent',
				'role'         => 'author',
				'instructions' => 'Be terse.',
			)
		);
		self::$agent_id = is_array( $agent ) ? (int) $agent['id'] : (int) $agent->ID;
		wp_set_current_user( 0 );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function request( $method, $path, array $params = array() ) {
		$req = new WP_REST_Request( $method, '/desktop-mode/v1' . $path );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		return $req;
	}

	private function create_conversation( array $messages = array() ) {
		if ( empty( $messages ) ) {
			$messages = array(
				array(
					'role' => 'user',
					'text' => 'Summarize post 12 for me please',
					'at'   => 1000,
				),
				array(
					'role' => 'agent',
					'text' => 'Here is the summary.',
					'at'   => 2000,
				),
			);
		}
		$response = open_station_agents_rest_conversations_create(
			$this->request(
				'POST',
				'/agents/conversations',
				array(
					'agentId'  => self::$agent_id,
					'messages' => $messages,
				)
			)
		);
		$this->assertNotWPError( $response );
		return $response->get_data();
	}

	/**
	 * @covers ::open_station_agent_conversations_register_routes
	 */
	public function test_routes_registered() {
		do_action( 'rest_api_init' );
		$routes = rest_get_server()->get_routes( 'desktop-mode/v1' );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/conversations', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/conversations/(?P<id>\d+)', $routes );
	}

	/**
	 * @covers ::open_station_agents_rest_conversations_create
	 */
	public function test_create_derives_title_and_owner() {
		$data = $this->create_conversation();

		$this->assertSame( self::$agent_id, $data['agentId'] );
		$this->assertSame( 'Conversation Agent', $data['agentName'] );
		$this->assertSame( 'Summarize post 12 for me please', $data['title'] );
		$this->assertSame( 2, $data['messageCount'] );
		$this->assertSame( 'user', $data['messages'][0]['role'] );

		$post = get_post( $data['id'] );
		$this->assertSame( OPEN_STATION_AGENT_CHAT_POST_TYPE, $post->post_type );
		$this->assertSame( self::$admin_id, (int) $post->post_author );
	}

	/**
	 * The list's second line reads from the END of the conversation:
	 * the title comes from the first user message, so every chat that
	 * starts the same way looks identical without it.
	 *
	 * @covers ::open_station_agent_conversation_preview
	 */
	public function test_preview_reads_the_tail_of_the_last_message() {
		$short = open_station_agent_conversation_preview(
			array(
				array(
					'role' => 'user',
					'text' => 'Summarize post 12',
					'at'   => 1,
				),
				array(
					'role' => 'agent',
					'text' => "Done.\n\nHere  it is.",
					'at'   => 2,
				),
			)
		);
		// Whitespace is collapsed so a multi-line answer stays one line.
		$this->assertSame( 'Done. Here it is.', $short );

		$tail = str_repeat( 'a', 200 ) . ' and search relevance.';
		$long = open_station_agent_conversation_preview(
			array(
				array(
					'role' => 'agent',
					'text' => $tail,
					'at'   => 1,
				),
			)
		);
		$this->assertStringStartsWith( '…', $long );
		$this->assertStringEndsWith( 'and search relevance.', $long );
		$this->assertSame(
			OPEN_STATION_AGENT_CONVERSATION_PREVIEW_CAP + 1,
			mb_strlen( $long )
		);

		$this->assertSame( '', open_station_agent_conversation_preview( array() ) );
	}

	/**
	 * @covers ::open_station_agent_conversation_preview
	 */
	public function test_preview_prefers_the_attachment_title() {
		$preview = open_station_agent_conversation_preview(
			array(
				array(
					'role'       => 'user',
					'text'       => 'The user dropped the post "Hello world" (id 12) onto you.',
					'at'         => 1,
					'attachment' => array(
						'kind'  => 'post',
						'id'    => 12,
						'title' => 'Hello world',
					),
				),
			)
		);
		$this->assertSame( 'Hello world', $preview );
	}

	/**
	 * A dropped / "Send to" object survives the round-trip so a
	 * reopened conversation still renders the clickable card.
	 *
	 * @covers ::open_station_agent_conversation_sanitize_attachment
	 * @covers ::open_station_agent_conversation_prepare
	 */
	public function test_attachments_round_trip_and_are_validated() {
		$data = $this->create_conversation(
			array(
				array(
					'role'       => 'user',
					'text'       => 'Handle this one.',
					'at'         => 1,
					'attachment' => array(
						'kind'  => 'media',
						'id'    => '44',
						'title' => '<em>Hornet</em>',
					),
				),
				array(
					'role'       => 'agent',
					'text'       => 'Rejected — unknown kind.',
					'at'         => 2,
					'attachment' => array(
						'kind'  => 'widget',
						'id'    => 7,
						'title' => 'Nope',
					),
				),
				array(
					'role'       => 'agent',
					'text'       => 'Rejected — no id.',
					'at'         => 3,
					'attachment' => array(
						'kind'  => 'post',
						'id'    => 0,
						'title' => 'Nope',
					),
				),
			)
		);

		$this->assertSame(
			array(
				'kind'  => 'media',
				'id'    => 44,
				'title' => 'Hornet',
			),
			$data['messages'][0]['attachment']
		);
		$this->assertArrayNotHasKey( 'attachment', $data['messages'][1] );
		$this->assertArrayNotHasKey( 'attachment', $data['messages'][2] );

		// Titleless attachments fall back to the id so the card always
		// has something to render.
		$this->assertSame(
			'#9',
			open_station_agent_conversation_sanitize_attachment(
				array(
					'kind' => 'user',
					'id'   => 9,
				)
			)['title']
		);
		$this->assertNull(
			open_station_agent_conversation_sanitize_attachment( 'not-an-array' )
		);
	}

	/**
	 * @covers ::open_station_agent_conversation_prepare
	 */
	public function test_prepare_ships_preview_and_last_role() {
		$data = $this->create_conversation();

		$this->assertSame( 'Here is the summary.', $data['preview'] );
		$this->assertSame( 'agent', $data['lastRole'] );
	}

	/**
	 * @covers ::open_station_agents_rest_conversations_create
	 */
	public function test_create_rejects_non_agent_target() {
		$response = open_station_agents_rest_conversations_create(
			$this->request(
				'POST',
				'/agents/conversations',
				array(
					'agentId'  => self::$editor_id,
					'messages' => array(
						array(
							'role' => 'user',
							'text' => 'hi',
						),
					),
				)
			)
		);
		$this->assertWPError( $response );
		$this->assertSame( 'open_station_agent_not_found', $response->get_error_code() );
	}

	/**
	 * @covers ::open_station_agent_conversation_sanitize_messages
	 */
	public function test_sanitizer_filters_roles_and_drops_tool_output() {
		$clean = open_station_agent_conversation_sanitize_messages(
			array(
				array(
					'role'      => 'agent',
					'text'      => 'Done.',
					'at'        => 5,
					'toolCalls' => array(
						array(
							'callId' => 'c1',
							'name'   => 'desktop-mode/get-post',
							'args'   => array( 'post_id' => 12 ),
							'output' => array( 'content' => str_repeat( 'x', 5000 ) ),
							'error'  => null,
						),
					),
				),
				array(
					'role' => 'system',
					'text' => 'invalid role',
				),
				array(
					'role' => 'user',
					'text' => '',
				),
				'not-a-row',
			)
		);

		$this->assertCount( 1, $clean );
		$this->assertSame( 'desktop-mode/get-post', $clean[0]['toolCalls'][0]['name'] );
		$this->assertArrayNotHasKey( 'output', $clean[0]['toolCalls'][0] );
	}

	/**
	 * Call-to-action buttons round-trip with the message, including the
	 * spent flag, so reopened conversations render them disabled.
	 *
	 * @covers ::open_station_agent_conversation_sanitize_messages
	 */
	public function test_sanitizer_keeps_call_to_actions() {
		$clean = open_station_agent_conversation_sanitize_messages(
			array(
				array(
					'role'          => 'agent',
					'text'          => 'Approve?',
					'ctaUsed'       => true,
					'callToActions' => array(
						array(
							'id'    => 'approve',
							'label' => 'Accept',
							'style' => 'primary',
							'reply' => 'Approved.',
						),
					),
				),
			)
		);
		$this->assertTrue( $clean[0]['ctaUsed'] );
		$this->assertSame( 'Accept', $clean[0]['callToActions'][0]['label'] );
		$this->assertSame( 'Approved.', $clean[0]['callToActions'][0]['reply'] );
	}

	/**
	 * @covers ::open_station_agent_conversation_sanitize_messages
	 */
	public function test_sanitizer_caps_message_count() {
		$many = array();
		for ( $i = 0; $i < OPEN_STATION_AGENT_CONVERSATION_MESSAGE_CAP + 25; $i++ ) {
			$many[] = array(
				'role' => 'user',
				'text' => "row {$i}",
			);
		}
		$clean = open_station_agent_conversation_sanitize_messages( $many );
		$this->assertCount( OPEN_STATION_AGENT_CONVERSATION_MESSAGE_CAP, $clean );
		// Newest rows survive.
		$this->assertSame( 'row ' . ( OPEN_STATION_AGENT_CONVERSATION_MESSAGE_CAP + 24 ), end( $clean )['text'] );
	}

	/**
	 * @covers ::open_station_agents_rest_conversations_list
	 */
	public function test_list_is_scoped_to_the_caller() {
		$this->create_conversation();

		$mine = open_station_agents_rest_conversations_list()->get_data();
		$this->assertCount( 1, $mine );
		$this->assertArrayNotHasKey( 'messages', $mine[0], 'The list must stay light — no message bodies.' );

		// Another user sees nothing — including administrators-of-other-people.
		wp_set_current_user( self::$editor_id );
		$theirs = open_station_agents_rest_conversations_list()->get_data();
		$this->assertSame( array(), $theirs );
	}

	/**
	 * @covers ::open_station_agents_rest_conversations_get
	 * @covers ::open_station_agents_rest_conversations_update
	 * @covers ::open_station_agents_rest_conversations_delete
	 */
	public function test_foreign_conversations_read_as_missing() {
		$data = $this->create_conversation();
		wp_set_current_user( self::$editor_id );

		$get = open_station_agents_rest_conversations_get(
			$this->request( 'GET', "/agents/conversations/{$data['id']}", array( 'id' => $data['id'] ) )
		);
		$this->assertWPError( $get );
		$this->assertSame( 404, $get->get_error_data()['status'] );

		$update = open_station_agents_rest_conversations_update(
			$this->request(
				'PUT',
				"/agents/conversations/{$data['id']}",
				array(
					'id'       => $data['id'],
					'messages' => array(
						array(
							'role' => 'user',
							'text' => 'hijack',
						),
					),
				)
			)
		);
		$this->assertWPError( $update );

		$del = open_station_agents_rest_conversations_delete(
			$this->request( 'DELETE', "/agents/conversations/{$data['id']}", array( 'id' => $data['id'] ) )
		);
		$this->assertWPError( $del );
		$this->assertInstanceOf( WP_Post::class, get_post( $data['id'] ) );
	}

	/**
	 * @covers ::open_station_agents_rest_conversations_update
	 */
	public function test_update_replaces_messages_and_retitles() {
		$data = $this->create_conversation();

		$response = open_station_agents_rest_conversations_update(
			$this->request(
				'PUT',
				"/agents/conversations/{$data['id']}",
				array(
					'id'       => $data['id'],
					'messages' => array(
						array(
							'role' => 'user',
							'text' => 'A different opener',
							'at'   => 1,
						),
						array(
							'role' => 'agent',
							'text' => 'A different answer',
							'at'   => 2,
						),
						array(
							'role' => 'user',
							'text' => 'Follow-up',
							'at'   => 3,
						),
					),
				)
			)
		);
		$this->assertNotWPError( $response );
		$updated = $response->get_data();
		$this->assertSame( 3, $updated['messageCount'] );
		$this->assertSame( 'A different opener', $updated['title'] );

		$reread = open_station_agents_rest_conversations_get(
			$this->request( 'GET', "/agents/conversations/{$data['id']}", array( 'id' => $data['id'] ) )
		)->get_data();
		$this->assertSame( 'Follow-up', end( $reread['messages'] )['text'] );
	}

	/**
	 * @covers ::open_station_agents_rest_conversations_delete
	 */
	public function test_delete_removes_the_row() {
		$data = $this->create_conversation();
		$response = open_station_agents_rest_conversations_delete(
			$this->request( 'DELETE', "/agents/conversations/{$data['id']}", array( 'id' => $data['id'] ) )
		);
		$this->assertNotWPError( $response );
		$this->assertNull( get_post( $data['id'] ) );
	}

	/**
	 * @covers ::open_station_agent_conversations_prune
	 */
	public function test_creating_past_the_cap_prunes_the_oldest() {
		$tighten = static function () {
			return 2;
		};
		add_filter( 'open_station_agent_conversation_cap', $tighten );

		try {
			$first = $this->create_conversation(
				array(
					array(
						'role' => 'user',
						'text' => 'the oldest conversation',
					),
				)
			);
			// Age it so the modified-date ordering is unambiguous.
			global $wpdb;
			$wpdb->update(
				$wpdb->posts,
				array( 'post_modified_gmt' => '2020-01-01 00:00:00' ),
				array( 'ID' => $first['id'] )
			);
			clean_post_cache( $first['id'] );

			$second = $this->create_conversation(
				array(
					array(
						'role' => 'user',
						'text' => 'still here',
					),
				)
			);
			$this->assertInstanceOf( WP_Post::class, get_post( $first['id'] ), 'Under the cap nothing is pruned.' );

			// The third create pushes past cap=2 — the aged row goes.
			$third = $this->create_conversation(
				array(
					array(
						'role' => 'user',
						'text' => 'the newest conversation',
					),
				)
			);
			$this->assertNull( get_post( $first['id'] ) );
			$this->assertInstanceOf( WP_Post::class, get_post( $second['id'] ) );
			$this->assertInstanceOf( WP_Post::class, get_post( $third['id'] ) );
		} finally {
			remove_filter( 'open_station_agent_conversation_cap', $tighten );
		}
	}

	/**
	 * @covers ::open_station_agent_runner_sanitize_history
	 */
	public function test_history_replay_cap_is_fifty() {
		$this->assertSame( 50, OPEN_STATION_AGENT_HISTORY_TURN_CAP );

		$many = array();
		for ( $i = 0; $i < 60; $i++ ) {
			$many[] = array(
				'role' => 'user',
				'text' => "turn {$i}",
			);
		}
		$clean = open_station_agent_runner_sanitize_history( $many );
		$this->assertCount( 50, $clean );
		$this->assertSame( 'turn 59', end( $clean )['text'] );
	}
}
