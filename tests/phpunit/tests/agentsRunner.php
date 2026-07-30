<?php
/**
 * Tests for the agents runner — network-free via the
 * `desktop_mode_agent_runner_generate` pre-filter, following the
 * pure-function style of the AI Copilot suites.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_AgentsRunner extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function create_agent( array $overrides = array() ) {
		$user = desktop_mode_agent_create(
			array_merge(
				array(
					'name'         => 'Runner Agent',
					'role'         => 'author',
					'instructions' => 'Answer briefly.',
				),
				$overrides
			)
		);
		$this->assertNotWPError( $user );
		return $user;
	}

	private function stub_generate( callable $turns ) {
		add_filter( 'desktop_mode_agent_runner_generate', $turns, 10, 5 );
	}

	/**
	 * @covers ::desktop_mode_agent_invoke
	 */
	public function test_invoke_returns_text_answer() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return array(
					'text'           => 'All done.',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = desktop_mode_agent_invoke( $agent->ID, 'Do the thing.' );
		$this->assertNotWPError( $result );
		$this->assertSame( 'All done.', $result['text'] );
		$this->assertSame( array(), $result['toolCalls'] );
		$this->assertSame( 1, $result['turns'] );
	}

	/**
	 * The tool loop runs with the current user switched to the agent,
	 * and the previous user is restored afterwards.
	 *
	 * @covers ::desktop_mode_agent_invoke
	 */
	public function test_invoke_switches_identity_and_restores() {
		$agent    = $this->create_agent();
		$seen_ids = array();
		$this->stub_generate(
			static function () use ( &$seen_ids ) {
				$seen_ids[] = get_current_user_id();
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		desktop_mode_agent_invoke( $agent->ID, 'hello' );

		$this->assertSame( array( (int) $agent->ID ), $seen_ids );
		$this->assertSame( self::$admin_id, get_current_user_id() );
	}

	/**
	 * @covers ::desktop_mode_agent_invoke
	 */
	public function test_invoke_fires_completed_action_with_context() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return array(
					'text'           => 'done',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$captured = null;
		add_action(
			'desktop_mode_agent_completed',
			static function ( $agent_id, $message, $result, $context ) use ( &$captured ) {
				$captured = array( $agent_id, $message, $result, $context );
			},
			10,
			4
		);

		desktop_mode_agent_invoke( $agent->ID, 'chain me', array( 'source' => 'chat' ) );

		$this->assertNotNull( $captured );
		$this->assertSame( (int) $agent->ID, $captured[0] );
		$this->assertSame( 'chain me', $captured[1] );
		$this->assertSame( 'done', $captured[2]['text'] );
		$this->assertSame( array( 'source' => 'chat' ), $captured[3] );
	}

	/**
	 * A function call outside the allowlist map is answered with an
	 * error result, not executed.
	 *
	 * @covers ::desktop_mode_agent_runner_loop
	 */
	public function test_unknown_tool_yields_error_result() {
		$agent = $this->create_agent();
		$turn  = 0;
		$this->stub_generate(
			static function () use ( &$turn ) {
				++$turn;
				if ( 1 === $turn ) {
					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'delete_everything',
								'call_id'   => 'call-1',
								'arguments' => '{}',
							),
						),
						'message'        => null,
					);
				}
				return array(
					'text'           => 'recovered',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = desktop_mode_agent_invoke( $agent->ID, 'go' );
		$this->assertNotWPError( $result );
		$this->assertSame( 2, $result['turns'] );
		$this->assertCount( 1, $result['toolCalls'] );
		$this->assertSame( 'delete_everything', $result['toolCalls'][0]['name'] );
		$this->assertNotNull( $result['toolCalls'][0]['error'] );
	}

	/**
	 * An allowlisted ability is executed as the agent and its output
	 * lands in the trace. Requires the Abilities API.
	 *
	 * @covers ::desktop_mode_agent_runner_dispatch_tool
	 * @covers ::desktop_mode_agent_runner_build_tools
	 */
	public function test_allowlisted_ability_dispatches() {
		if ( ! function_exists( 'wp_get_ability' ) || ! wp_get_ability( 'desktop-mode/get-post' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}

		$post_id = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_title'  => 'Readable post',
			)
		);
		$agent   = $this->create_agent(
			array( 'abilities' => array( 'desktop-mode/get-post' ) )
		);

		$turn = 0;
		$this->stub_generate(
			static function () use ( &$turn, $post_id ) {
				++$turn;
				if ( 1 === $turn ) {
					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'get_post',
								'call_id'   => 'call-1',
								'arguments' => wp_json_encode( array( 'post_id' => $post_id ) ),
							),
						),
						'message'        => null,
					);
				}
				return array(
					'text'           => 'fetched',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = desktop_mode_agent_invoke( $agent->ID, 'read it' );
		$this->assertNotWPError( $result );
		$this->assertCount( 1, $result['toolCalls'] );
		$call = $result['toolCalls'][0];
		$this->assertSame( 'desktop-mode/get-post', $call['name'] );
		$this->assertNull( $call['error'] );
		$this->assertSame( 'Readable post', $call['output']['title'] );
	}

	/**
	 * Tool schemas advertised to the model are projected through the
	 * Copilot's provider-safe normalizer. One ability with a top-level
	 * `oneOf`/`anyOf`/`allOf` (or a `type` union) 400s the WHOLE
	 * request otherwise ("input_schema does not support oneOf, allOf,
	 * or anyOf at the top level").
	 *
	 * @covers ::desktop_mode_agent_runner_build_tools
	 */
	public function test_build_tools_normalizes_schemas() {
		if ( ! function_exists( 'wp_get_ability' ) || ! wp_get_ability( 'desktop-mode/get-post' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}

		list( $tools ) = desktop_mode_agent_runner_build_tools( array( 'desktop-mode/get-post' ) );

		$this->assertCount( 1, $tools );
		$this->assertSame(
			desktop_mode_ai_normalize_tool_schema(
				wp_get_ability( 'desktop-mode/get-post' )->get_input_schema()
			),
			$tools[0]['parameters']
		);
		$this->assertSame( 'object', $tools[0]['parameters']['type'] );
		$this->assertArrayNotHasKey( 'oneOf', $tools[0]['parameters'] );
		$this->assertArrayNotHasKey( 'anyOf', $tools[0]['parameters'] );
		$this->assertArrayNotHasKey( 'allOf', $tools[0]['parameters'] );
	}

	/**
	 * History flattens to a single user-message text: the original
	 * request plus a tool transcript. No functionCall replay means no
	 * provider signature requirements (Gemini `thought_signature`,
	 * Anthropic thinking signatures).
	 *
	 * @covers ::desktop_mode_agent_runner_compose_prompt
	 */
	public function test_compose_prompt_flattens_history() {
		$bare = desktop_mode_agent_runner_compose_prompt(
			array(
				array(
					'type' => 'user_text',
					'text' => 'Audit post 7.',
				),
			)
		);
		$this->assertSame( 'Audit post 7.', $bare );

		$with_tools = desktop_mode_agent_runner_compose_prompt(
			array(
				array(
					'type' => 'user_text',
					'text' => 'Audit post 7.',
				),
				array(
					'type'    => 'assistant',
					'message' => null,
				),
				array(
					'type'    => 'tool_results',
					'results' => array(
						array(
							'call_id'  => 'c1',
							'name'     => 'get_post',
							'args'     => array( 'post_id' => 7 ),
							'response' => array( 'title' => 'Hello' ),
						),
					),
				),
			)
		);

		$this->assertStringStartsWith( 'Audit post 7.', $with_tools );
		$this->assertStringContainsString( 'get_post({"post_id":7})', $with_tools );
		$this->assertStringContainsString( '{"title":"Hello"}', $with_tools );
		$this->assertStringContainsString( 'do not repeat an identical call', $with_tools );
	}

	/**
	 * The second generate turn sees the executed call (with args) in
	 * the neutral history the transcript is built from.
	 *
	 * @covers ::desktop_mode_agent_runner_loop
	 */
	public function test_tool_results_rows_carry_args() {
		$agent     = $this->create_agent();
		$turn      = 0;
		$histories = array();
		$this->stub_generate(
			static function ( $ignored, $history ) use ( &$turn, &$histories ) {
				++$turn;
				$histories[] = $history;
				if ( 1 === $turn ) {
					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'missing_tool',
								'call_id'   => 'c1',
								'arguments' => '{"x":1}',
							),
						),
						'message'        => null,
					);
				}
				return array(
					'text'           => 'done',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		desktop_mode_agent_invoke( $agent->ID, 'go' );

		$this->assertCount( 2, $histories );
		$second = $histories[1];
		$rows   = wp_list_pluck( $second, 'type' );
		$this->assertContains( 'tool_results', $rows );
		foreach ( $second as $row ) {
			if ( 'tool_results' === $row['type'] ) {
				$this->assertSame( array( 'x' => 1 ), $row['results'][0]['args'] );
			}
		}
	}

	/**
	 * Prior conversation turns reach the prompt, oldest first, ahead of
	 * the new message. Without this a follow-up ("yes, do it") is a
	 * contextless run and the agent can act on the wrong entity — the
	 * reported bug where an approval wrote to a different post than the
	 * one proposed.
	 *
	 * @covers ::desktop_mode_agent_runner_compose_prompt
	 */
	public function test_prior_turns_precede_the_new_message() {
		$prompt = desktop_mode_agent_runner_compose_prompt(
			array(
				array(
					'type' => 'prior',
					'role' => 'user',
					'text' => 'Summarize post 973.',
				),
				array(
					'type' => 'prior',
					'role' => 'agent',
					'text' => 'Proposal for post 973 — approve?',
				),
				array(
					'type' => 'user_text',
					'text' => 'Yes, please',
				),
			)
		);

		$this->assertStringContainsString( 'Conversation so far', $prompt );
		$this->assertStringContainsString( 'User: Summarize post 973.', $prompt );
		$this->assertStringContainsString( 'You: Proposal for post 973', $prompt );
		// The new message comes last, after the replayed turns.
		$this->assertGreaterThan(
			strpos( $prompt, 'Proposal for post 973' ),
			strpos( $prompt, 'Yes, please' )
		);
	}

	/**
	 * @covers ::desktop_mode_agent_runner_sanitize_history
	 */
	public function test_history_sanitizer_filters_and_caps() {
		$clean = desktop_mode_agent_runner_sanitize_history(
			array(
				array(
					'role' => 'user',
					'text' => '  hello  ',
				),
				array(
					'role' => 'system',
					'text' => 'not a valid role',
				),
				array(
					'role' => 'agent',
					'text' => '',
				),
				'not-a-row',
			)
		);
		$this->assertSame( array( array( 'role' => 'user', 'text' => 'hello' ) ), $clean );

		$long = desktop_mode_agent_runner_sanitize_history(
			array(
				array(
					'role' => 'user',
					'text' => str_repeat( 'x', DESKTOP_MODE_AGENT_HISTORY_TEXT_CAP + 500 ),
				),
			)
		);
		$this->assertSame(
			DESKTOP_MODE_AGENT_HISTORY_TEXT_CAP,
			mb_strlen( $long[0]['text'] )
		);

		$many = array();
		for ( $i = 0; $i < DESKTOP_MODE_AGENT_HISTORY_TURN_CAP + 5; $i++ ) {
			$many[] = array(
				'role' => 'user',
				'text' => 'turn ' . $i,
			);
		}
		$capped = desktop_mode_agent_runner_sanitize_history( $many );
		$this->assertCount( DESKTOP_MODE_AGENT_HISTORY_TURN_CAP, $capped );
		// The most RECENT turns survive — the oldest roll off.
		$this->assertSame( 'turn ' . ( DESKTOP_MODE_AGENT_HISTORY_TURN_CAP + 4 ), end( $capped )['text'] );
	}

	/**
	 * History supplied through the invocation context reaches the
	 * generate call.
	 *
	 * @covers ::desktop_mode_agent_invoke
	 */
	public function test_invoke_replays_context_history() {
		$agent   = $this->create_agent();
		$prompts = array();
		$this->stub_generate(
			static function ( $ignored, $history ) use ( &$prompts ) {
				$prompts[] = desktop_mode_agent_runner_compose_prompt( $history );
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		desktop_mode_agent_invoke(
			$agent->ID,
			'Yes, please',
			array(
				'source'  => 'chat',
				'history' => array(
					array(
						'role' => 'user',
						'text' => 'Summarize post 973.',
					),
					array(
						'role' => 'agent',
						'text' => 'Proposal for post 973 — approve?',
					),
				),
			)
		);

		$this->assertStringContainsString( 'post 973', $prompts[0] );
		$this->assertStringContainsString( 'Yes, please', $prompts[0] );
	}

	/**
	 * @covers ::desktop_mode_agent_runner_check_rate_limit
	 */
	public function test_rate_limit_blocks_after_cap() {
		$agent = $this->create_agent();
		desktop_mode_agent_update( $agent->ID, array( 'rateLimit' => 1 ) );
		$this->stub_generate(
			static function () {
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$first = desktop_mode_agent_invoke( $agent->ID, 'one' );
		$this->assertNotWPError( $first );

		$second = desktop_mode_agent_invoke( $agent->ID, 'two' );
		$this->assertWPError( $second );
		$this->assertSame( 'desktop_mode_agent_rate_limited', $second->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_agent_invoke
	 */
	public function test_invoke_validates_agent_and_message() {
		$this->stub_generate(
			static function () {
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$not_agent = desktop_mode_agent_invoke( self::$admin_id, 'hi' );
		$this->assertWPError( $not_agent );
		$this->assertSame( 'desktop_mode_agent_not_found', $not_agent->get_error_code() );

		$agent = $this->create_agent();
		$empty = desktop_mode_agent_invoke( $agent->ID, '   ' );
		$this->assertWPError( $empty );
		$this->assertSame( 'desktop_mode_agent_empty_message', $empty->get_error_code() );
	}

	/**
	 * Without the pre-filter and without the AI Client, the runner
	 * reports unavailability instead of fataling.
	 *
	 * @covers ::desktop_mode_agent_runner_available
	 */
	public function test_unavailable_without_client_or_stub() {
		if ( function_exists( 'desktop_mode_ai_is_available' ) && desktop_mode_ai_is_available() ) {
			$this->markTestSkipped( 'AI Client available on this environment.' );
		}
		$agent  = $this->create_agent();
		$result = desktop_mode_agent_invoke( $agent->ID, 'hi' );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_agent_ai_unavailable', $result->get_error_code() );
	}

	/**
	 * The runner gives up at the turn cap instead of looping forever.
	 *
	 * @covers ::desktop_mode_agent_runner_loop
	 */
	public function test_turn_cap_stops_runaway_loop() {
		$agent = $this->create_agent();
		$calls = 0;
		$this->stub_generate(
			static function () use ( &$calls ) {
				++$calls;
				return array(
					'text'           => null,
					'function_calls' => array(
						array(
							'name'      => 'never_registered',
							'call_id'   => 'call-' . $calls,
							'arguments' => '{}',
						),
					),
					'message'        => null,
				);
			}
		);

		$result = desktop_mode_agent_invoke( $agent->ID, 'loop' );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_agent_runner_max_turns', $result->get_error_code() );
		$this->assertSame( DESKTOP_MODE_AGENT_RUNNER_MAX_TURNS, $calls );
	}

	/**
	 * @covers ::desktop_mode_agent_runner_log_invocation
	 */
	public function test_invocations_are_logged() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return array(
					'text'           => 'logged answer',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		desktop_mode_agent_invoke( $agent->ID, 'log me' );

		$log = desktop_mode_agent_runner_get_log( $agent->ID );
		$this->assertCount( 1, $log );
		$this->assertSame( 'done', $log[0]['status'] );
		$this->assertSame( 'log me', $log[0]['message'] );
		$this->assertSame( 'logged answer', $log[0]['text'] );
	}
}
