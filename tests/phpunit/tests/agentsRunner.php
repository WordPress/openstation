<?php

class Tests_OpenStation_AgentsRunner extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function create_agent( array $overrides = array() ) {
		$user = openstation_agent_create(
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
		add_filter( 'openstation_agent_runner_generate', $turns, 10, 5 );
	}

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

		$result = openstation_agent_invoke( $agent->ID, 'Do the thing.' );
		$this->assertNotWPError( $result );
		$this->assertSame( 'All done.', $result['text'] );
		$this->assertSame( array(), $result['toolCalls'] );
		$this->assertSame( 1, $result['turns'] );
	}

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

		openstation_agent_invoke( $agent->ID, 'hello' );

		$this->assertSame( array( (int) $agent->ID ), $seen_ids );
		$this->assertSame( self::$admin_id, get_current_user_id() );
	}

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
			'openstation_agent_completed',
			static function ( $agent_id, $message, $result, $context ) use ( &$captured ) {
				$captured = array( $agent_id, $message, $result, $context );
			},
			10,
			4
		);

		openstation_agent_invoke( $agent->ID, 'chain me', array( 'source' => 'chat' ) );

		$this->assertNotNull( $captured );
		$this->assertSame( (int) $agent->ID, $captured[0] );
		$this->assertSame( 'chain me', $captured[1] );
		$this->assertSame( 'done', $captured[2]['text'] );
		$this->assertSame( array( 'source' => 'chat' ), $captured[3] );
	}

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

		$result = openstation_agent_invoke( $agent->ID, 'go' );
		$this->assertNotWPError( $result );
		$this->assertSame( 2, $result['turns'] );
		$this->assertCount( 1, $result['toolCalls'] );
		$this->assertSame( 'delete_everything', $result['toolCalls'][0]['name'] );
		$this->assertNotNull( $result['toolCalls'][0]['error'] );
	}

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

		$result = openstation_agent_invoke( $agent->ID, 'read it' );
		$this->assertNotWPError( $result );
		$this->assertCount( 1, $result['toolCalls'] );
		$call = $result['toolCalls'][0];
		$this->assertSame( 'desktop-mode/get-post', $call['name'] );
		$this->assertNull( $call['error'] );
		$this->assertSame( 'Readable post', $call['output']['title'] );
	}

	public function test_build_tools_normalizes_schemas() {
		if ( ! function_exists( 'wp_get_ability' ) || ! wp_get_ability( 'desktop-mode/get-post' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}

		list( $tools ) = openstation_agent_runner_build_tools( array( 'desktop-mode/get-post' ) );

		$this->assertCount( 1, $tools );
		$this->assertSame(
			openstation_ai_normalize_tool_schema(
				wp_get_ability( 'desktop-mode/get-post' )->get_input_schema()
			),
			$tools[0]['parameters']
		);
		$this->assertSame( 'object', $tools[0]['parameters']['type'] );
		$this->assertArrayNotHasKey( 'oneOf', $tools[0]['parameters'] );
		$this->assertArrayNotHasKey( 'anyOf', $tools[0]['parameters'] );
		$this->assertArrayNotHasKey( 'allOf', $tools[0]['parameters'] );
	}

	public function test_compose_prompt_flattens_history() {
		$bare = openstation_agent_runner_compose_prompt(
			array(
				array(
					'type' => 'user_text',
					'text' => 'Audit post 7.',
				),
			)
		);
		$this->assertSame( 'Audit post 7.', $bare );

		$with_tools = openstation_agent_runner_compose_prompt(
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

		openstation_agent_invoke( $agent->ID, 'go' );

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

	public function test_prior_turns_precede_the_new_message() {
		$prompt = openstation_agent_runner_compose_prompt(
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

		$this->assertGreaterThan(
			strpos( $prompt, 'Proposal for post 973' ),
			strpos( $prompt, 'Yes, please' )
		);
	}

	public function test_history_sanitizer_filters_and_caps() {
		$clean = openstation_agent_runner_sanitize_history(
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

		$long = openstation_agent_runner_sanitize_history(
			array(
				array(
					'role' => 'user',
					'text' => str_repeat( 'x', OPENSTATION_AGENT_HISTORY_TEXT_CAP + 500 ),
				),
			)
		);
		$this->assertSame(
			OPENSTATION_AGENT_HISTORY_TEXT_CAP,
			mb_strlen( $long[0]['text'] )
		);

		$many = array();
		for ( $i = 0; $i < OPENSTATION_AGENT_HISTORY_TURN_CAP + 5; $i++ ) {
			$many[] = array(
				'role' => 'user',
				'text' => 'turn ' . $i,
			);
		}
		$capped = openstation_agent_runner_sanitize_history( $many );
		$this->assertCount( OPENSTATION_AGENT_HISTORY_TURN_CAP, $capped );

		$this->assertSame( 'turn ' . ( OPENSTATION_AGENT_HISTORY_TURN_CAP + 4 ), end( $capped )['text'] );
	}

	public function test_invoke_replays_context_history() {
		$agent   = $this->create_agent();
		$prompts = array();
		$this->stub_generate(
			static function ( $ignored, $history ) use ( &$prompts ) {
				$prompts[] = openstation_agent_runner_compose_prompt( $history );
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		openstation_agent_invoke(
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

	public function test_rate_limit_blocks_after_cap() {
		$agent = $this->create_agent();
		openstation_agent_update( $agent->ID, array( 'rateLimit' => 1 ) );
		$this->stub_generate(
			static function () {
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$first = openstation_agent_invoke( $agent->ID, 'one' );
		$this->assertNotWPError( $first );

		$second = openstation_agent_invoke( $agent->ID, 'two' );
		$this->assertWPError( $second );
		$this->assertSame( 'openstation_agent_rate_limited', $second->get_error_code() );
	}

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

		$not_agent = openstation_agent_invoke( self::$admin_id, 'hi' );
		$this->assertWPError( $not_agent );
		$this->assertSame( 'openstation_agent_not_found', $not_agent->get_error_code() );

		$agent = $this->create_agent();
		$empty = openstation_agent_invoke( $agent->ID, '   ' );
		$this->assertWPError( $empty );
		$this->assertSame( 'openstation_agent_empty_message', $empty->get_error_code() );
	}

	public function test_unavailable_without_client_or_stub() {
		if ( function_exists( 'openstation_ai_is_available' ) && openstation_ai_is_available() ) {
			$this->markTestSkipped( 'AI Client available on this environment.' );
		}
		$agent  = $this->create_agent();
		$result = openstation_agent_invoke( $agent->ID, 'hi' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_ai_unavailable', $result->get_error_code() );
	}

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
							'name'      => 'never_registered_' . $calls,
							'call_id'   => 'call-' . $calls,
							'arguments' => '{}',
						),
					),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'loop' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_runner_max_turns', $result->get_error_code() );

		$this->assertSame( OPENSTATION_AGENT_RUNNER_MAX_TURNS + 1, $calls );
	}

	public function test_turn_cap_forces_a_final_toolless_answer() {
		$agent = $this->create_agent();
		$calls          = 0;
		$forced_tools   = null;
		$this->stub_generate(
			static function ( $ignored, $history, $tool_defs ) use ( &$calls, &$forced_tools ) {
				++$calls;
				if ( $calls <= OPENSTATION_AGENT_RUNNER_MAX_TURNS ) {
					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'never_registered_' . $calls,
								'call_id'   => 'call-' . $calls,
								'arguments' => '{}',
							),
						),
						'message'        => null,
					);
				}
				$forced_tools = $tool_defs;
				return array(
					'text'           => 'Best effort from what I gathered.',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'loop' );
		$this->assertNotWPError( $result );
		$this->assertSame( 'Best effort from what I gathered.', $result['text'] );
		$this->assertSame( OPENSTATION_AGENT_RUNNER_MAX_TURNS + 1, $result['turns'] );
		$this->assertSame( array(), $forced_tools, 'The forced final turn must advertise no tools.' );
	}

	public function test_repeated_identical_tool_failures_stop_the_loop_early() {
		$agent = $this->create_agent();
		$calls = 0;
		$this->stub_generate(
			static function () use ( &$calls ) {
				++$calls;
				if ( $calls <= OPENSTATION_AGENT_RUNNER_STUCK_TURNS ) {

					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'never_registered',
								'call_id'   => 'call-' . $calls,
								'arguments' => wp_json_encode( array( 'attempt' => $calls ) ),
							),
						),
						'message'        => null,
					);
				}
				return array(
					'text'           => 'I could not complete this: the tool kept rejecting the call.',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'loop' );
		$this->assertNotWPError( $result );
		$this->assertSame( OPENSTATION_AGENT_RUNNER_STUCK_TURNS + 1, $calls, 'Three stuck turns, then the forced answer.' );
		$this->assertSame( OPENSTATION_AGENT_RUNNER_STUCK_TURNS + 1, $result['turns'] );
		$this->assertCount( OPENSTATION_AGENT_RUNNER_STUCK_TURNS, $result['toolCalls'] );
	}

	public function test_failure_signature_ignores_args_and_needs_every_call_to_fail() {
		$failed = array(
			'call_id'  => 'a',
			'name'     => 'create_post',
			'args'     => array( 'title' => 'One' ),
			'response' => array( 'error' => 'content is a required property of input.' ),
		);
		$again  = array_merge( $failed, array( 'args' => array( 'title' => 'Two' ) ) );
		$worked = array(
			'call_id'  => 'b',
			'name'     => 'get_post',
			'args'     => array( 'post_id' => 1 ),
			'response' => array( 'id' => 1 ),
		);

		$this->assertNotSame( '', openstation_agent_runner_failure_signature( array( $failed ) ) );
		$this->assertSame(
			openstation_agent_runner_failure_signature( array( $failed ) ),
			openstation_agent_runner_failure_signature( array( $again ) ),
			'Different arguments, same rejection: the same failure.'
		);
		$this->assertSame( '', openstation_agent_runner_failure_signature( array( $failed, $worked ) ), 'A turn that got something done is not stuck.' );
		$this->assertSame( '', openstation_agent_runner_failure_signature( array() ) );
	}

	public function test_truncated_output_is_permanent_and_translated_for_the_user() {
		$raw = openstation_ai_output_truncated_error( 'finish reason: length', array( 'completion' => 4096 ) );
		$this->assertFalse( openstation_agent_generate_error_is_transient( $raw ) );

		$human = openstation_agent_humanize_generate_error( $raw );
		$this->assertSame( 'openstation_agent_output_truncated', $human->get_error_code() );
		$this->assertNotSame( '', trim( $human->get_error_message() ) );
		$this->assertSame( 502, $human->get_error_data()['status'] );
		$this->assertSame( 'finish reason: length', $human->get_error_data()['detail'] );
	}

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

		openstation_agent_invoke( $agent->ID, 'log me' );

		$log = openstation_agent_runner_get_log( $agent->ID );
		$this->assertCount( 1, $log );
		$this->assertSame( 'done', $log[0]['status'] );
		$this->assertSame( 'log me', $log[0]['message'] );
		$this->assertSame( 'logged answer', $log[0]['text'] );
	}

	public function test_parse_answer_is_lenient() {

		$plain = openstation_agent_parse_answer( 'Just words.' );
		$this->assertSame( 'Just words.', $plain['text'] );
		$this->assertSame( array(), $plain['callToActions'] );

		$json = wp_json_encode(
			array(
				'text'            => 'Apply the TL;DR to post 188?',
				'call_to_actions' => array(
					array(
						'id'    => 'approve',
						'label' => 'Accept',
						'style' => 'primary',
						'reply' => 'Approved. Apply the proposed TL;DR to post 188.',
					),
					array(
						'id'    => 'cancel',
						'label' => 'Cancel',
						'style' => 'not-a-style',
						'reply' => 'Cancelled.',
					),
					array(
						'label' => 'No reply — dropped',
					),
				),
			)
		);
		$parsed = openstation_agent_parse_answer( $json );
		$this->assertSame( 'Apply the TL;DR to post 188?', $parsed['text'] );
		$this->assertCount( 2, $parsed['callToActions'] );
		$this->assertSame( 'approve', $parsed['callToActions'][0]['id'] );
		$this->assertSame( 'primary', $parsed['callToActions'][0]['style'] );

		$this->assertSame( 'secondary', $parsed['callToActions'][1]['style'] );

		$fenced = openstation_agent_parse_answer( "```json\n" . $json . "\n```" );
		$this->assertSame( 'Apply the TL;DR to post 188?', $fenced['text'] );
		$this->assertCount( 2, $fenced['callToActions'] );
	}

	public function test_call_to_actions_caps() {
		$many = array();
		for ( $i = 0; $i < OPENSTATION_AGENT_CTA_CAP + 3; $i++ ) {
			$many[] = array(
				'id'    => "a{$i}",
				'label' => str_repeat( 'L', OPENSTATION_AGENT_CTA_LABEL_CAP + 20 ),
				'reply' => str_repeat( 'R', OPENSTATION_AGENT_CTA_REPLY_CAP + 20 ),
			);
		}
		$clean = openstation_agent_sanitize_call_to_actions( $many );
		$this->assertCount( OPENSTATION_AGENT_CTA_CAP, $clean );
		$this->assertSame( OPENSTATION_AGENT_CTA_LABEL_CAP, mb_strlen( $clean[0]['label'] ) );
		$this->assertSame( OPENSTATION_AGENT_CTA_REPLY_CAP, mb_strlen( $clean[0]['reply'] ) );
	}

	public function test_invoke_returns_call_to_actions() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return array(
					'text'           => (string) wp_json_encode(
						array(
							'text'            => 'Approve the update?',
							'call_to_actions' => array(
								array(
									'id'    => 'approve',
									'label' => 'Accept',
									'style' => 'primary',
									'reply' => 'Approved.',
								),
							),
						)
					),
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Propose the update.' );
		$this->assertNotWPError( $result );
		$this->assertSame( 'Approve the update?', $result['text'] );
		$this->assertCount( 1, $result['callToActions'] );
		$this->assertSame( 'Accept', $result['callToActions'][0]['label'] );
		$this->assertSame( 'Approved.', $result['callToActions'][0]['reply'] );
	}

	public function test_http_timeout_is_raised_for_the_provider_request() {
		$seen = null;
		openstation_agent_with_http_timeout(
			static function () use ( &$seen ) {
				$seen = apply_filters( 'http_request_timeout', 5, 'https://api.anthropic.com/v1/messages' );
			}
		);

		$this->assertSame( OPENSTATION_AGENT_HTTP_TIMEOUT, $seen );
	}

	public function test_ai_client_request_timeout_is_raised_too() {
		$seen = null;
		openstation_agent_with_http_timeout(
			static function () use ( &$seen ) {
				$seen = apply_filters( 'wp_ai_client_default_request_timeout', 30.0 );
			}
		);

		$this->assertSame( (float) OPENSTATION_AGENT_HTTP_TIMEOUT, $seen );

		$this->assertSame( 30.0, apply_filters( 'wp_ai_client_default_request_timeout', 30.0 ) );
	}

	public function test_http_timeout_is_released_after_the_call() {
		openstation_agent_with_http_timeout( static function () {} );

		$this->assertSame( 5, apply_filters( 'http_request_timeout', 5, 'https://example.com/' ) );
	}

	public function test_http_timeout_is_released_when_the_callback_throws() {
		try {
			openstation_agent_with_http_timeout(
				static function () {
					throw new RuntimeException( 'provider exploded' );
				}
			);
			$this->fail( 'Expected the exception to propagate.' );
		} catch ( RuntimeException $e ) {
			$this->assertSame( 'provider exploded', $e->getMessage() );
		}

		$this->assertSame( 5, apply_filters( 'http_request_timeout', 5, 'https://example.com/' ) );
	}

	public function test_http_timeout_never_lowers_a_larger_site_value() {
		$larger = OPENSTATION_AGENT_HTTP_TIMEOUT + 120;
		$seen   = null;

		openstation_agent_with_http_timeout(
			static function () use ( &$seen, $larger ) {
				$seen = apply_filters( 'http_request_timeout', $larger, 'https://api.anthropic.com/v1/messages' );
			}
		);

		$this->assertSame( $larger, $seen );
	}

	public function test_http_timeout_filter_can_disable_the_override() {
		add_filter( 'openstation_agent_http_timeout', '__return_zero' );

		$seen = null;
		openstation_agent_with_http_timeout(
			static function () use ( &$seen ) {
				$seen = apply_filters( 'http_request_timeout', 5, 'https://api.anthropic.com/v1/messages' );
			}
		);

		remove_filter( 'openstation_agent_http_timeout', '__return_zero' );
		$this->assertSame( 5, $seen );
	}

	public function test_override_is_scoped_to_the_ai_client_call() {
		$agent  = $this->create_agent();
		$during = null;

		$this->stub_generate(
			static function () use ( &$during ) {
				$during = apply_filters( 'http_request_timeout', 5, 'https://example.com/' );
				return array(
					'text'           => 'done',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'go' );

		$this->assertNotWPError( $result );
		$this->assertSame( 5, $during );
	}

	public function test_transient_error_detection() {
		$transient = array(
			'Unexpected Anthropic API response: Missing the "content" key.',
			'No models found that support text_generation for this prompt.',
			'Gateway Timeout (504) - upstream timed out',
			'cURL error 28: Operation timed out after 180001 milliseconds',
		);
		foreach ( $transient as $message ) {
			$this->assertTrue(
				openstation_agent_generate_error_is_transient( new WP_Error( 'e', $message ) ),
				"Should be transient: {$message}"
			);
		}

		$permanent = array(
			"Bad Request (400) - Invalid schema for response_format 'response_schema'.",
			'Message must be a non-empty string.',
			'This agent reached its hourly invocation limit.',
		);
		foreach ( $permanent as $message ) {
			$this->assertFalse(
				openstation_agent_generate_error_is_transient( new WP_Error( 'e', $message ) ),
				"Should be permanent: {$message}"
			);
		}
	}

	public function test_transient_generate_failure_is_retried_once() {
		$agent = $this->create_agent();
		$calls = 0;
		$this->stub_generate(
			static function () use ( &$calls ) {
				$calls++;
				if ( 1 === $calls ) {
					return new WP_Error(
						'openstation_ai_error',
						'Unexpected Anthropic API response: Missing the "content" key.'
					);
				}
				return array(
					'text'           => 'Recovered.',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Say hi.' );
		$this->assertNotWPError( $result );
		$this->assertSame( 'Recovered.', $result['text'] );
		$this->assertSame( 2, $calls );
	}

	public function test_permanent_generate_failure_is_not_retried() {
		$agent = $this->create_agent();
		$calls = 0;
		$this->stub_generate(
			static function () use ( &$calls ) {
				$calls++;
				return new WP_Error(
					'openstation_ai_error',
					"Bad Request (400) - Invalid schema for response_format 'response_schema'."
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Say hi.' );
		$this->assertWPError( $result );
		$this->assertSame( 1, $calls );
	}

	public function test_refusal_is_translated_for_the_user() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return new WP_Error(
					'openstation_ai_error',
					'Unexpected Anthropic API response: Missing the "content" key.'
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Translate this.' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_provider_refusal', $result->get_error_code() );
		$this->assertStringContainsString( 'safety system', $result->get_error_message() );

		$this->assertStringContainsString( 'Missing the "content" key', $result->get_error_data()['detail'] );
	}

	public function test_persistent_transient_failure_surfaces_after_one_retry() {
		$agent = $this->create_agent();
		$calls = 0;
		$this->stub_generate(
			static function () use ( &$calls ) {
				$calls++;
				return new WP_Error(
					'openstation_ai_error',
					'Gateway Timeout (504) - upstream timed out'
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Say hi.' );
		$this->assertWPError( $result );
		$this->assertSame( 2, $calls );
	}

	public function test_textless_final_turn_is_an_error_not_an_empty_success() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return array(
					'text'           => null,
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Do the thing.' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_empty_answer', $result->get_error_code() );
		$this->assertNotSame( '', trim( $result->get_error_message() ) );
	}

	public function test_whitespace_only_final_turn_is_an_error() {
		$agent = $this->create_agent();
		$this->stub_generate(
			static function () {
				return array(
					'text'           => "  \n\t",
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Do the thing.' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_empty_answer', $result->get_error_code() );
	}

	public function test_humanize_maps_empty_answer_to_actionable_message() {
		$raw = openstation_ai_empty_answer_error( 'The provider response contains no text part.' );
		$this->assertWPError( $raw );
		$this->assertSame( 'openstation_ai_empty_answer', $raw->get_error_code() );

		$human = openstation_agent_humanize_generate_error( $raw );
		$this->assertSame( 'openstation_agent_empty_answer', $human->get_error_code() );

		$this->assertNotSame( '', trim( $human->get_error_message() ) );
		$this->assertSame( 502, $human->get_error_data()['status'] );
		$this->assertSame(
			'The provider response contains no text part.',
			$human->get_error_data()['detail']
		);
	}
}
