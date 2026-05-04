<?php
/**
 * Tests for the Routines engine.
 *
 * Covers the validator, the executor's dispatch + condition logic,
 * the rate-limit guard, the run-history persistence path, and the
 * registration APIs.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group routines
 */
class Tests_DesktopMode_Routines extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();
		// dbDelta runs idempotently; force-create on each test to be safe.
		wpdm_routine_install_runs_table();
	}

	public function tear_down() {
		global $wpdb;
		$wpdb->query( 'DELETE FROM ' . wpdm_routine_runs_table() );
		parent::tear_down();
	}

	// ---- Schema validator -------------------------------------------------

	/**
	 * @covers ::wpdm_routine_validate_def
	 */
	public function test_validator_rejects_non_array_input() {
		$this->assertWPError( wpdm_routine_validate_def( 'not an array' ) );
		$this->assertWPError( wpdm_routine_validate_def( null ) );
	}

	/**
	 * @covers ::wpdm_routine_validate_def
	 */
	public function test_validator_normalises_minimal_def() {
		$def = wpdm_routine_validate_def(
			array(
				'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
				'steps'   => array(),
			)
		);
		$this->assertIsArray( $def );
		$this->assertSame( 1, $def['version'] );
		$this->assertSame( 'hook', $def['trigger']['kind'] );
		$this->assertSame( 'publish_post', $def['trigger']['id'] );
		$this->assertSame( 10, $def['trigger']['priority'] );
		$this->assertSame( 'author', $def['run_as'] );
		$this->assertTrue( $def['settings']['stop_on_error'] );
		$this->assertSame( 5000, $def['settings']['timeout_ms'] );
	}

	/**
	 * @covers ::wpdm_routine_validate_def
	 */
	public function test_validator_rejects_unknown_step_kind() {
		$result = wpdm_routine_validate_def(
			array(
				'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
				'steps'   => array( array( 'kind' => 'launch_missile' ) ),
			)
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_step_kind_invalid', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdm_routine_validate_def
	 */
	public function test_validator_rejects_invalid_trigger_id() {
		$result = wpdm_routine_validate_def(
			array(
				'trigger' => array( 'kind' => 'hook', 'id' => 'has spaces and < > !' ),
				'steps'   => array(),
			)
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_trigger_id_invalid', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdm_routine_validate_def
	 */
	public function test_validator_recurses_into_if_branches() {
		$result = wpdm_routine_validate_def(
			array(
				'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
				'steps'   => array(
					array(
						'kind'      => 'if',
						'condition' => array( 'left' => 1, 'op' => 'eq', 'right' => 1 ),
						'then'      => array( array( 'kind' => 'log', 'args' => array( 'message' => 'ok' ) ) ),
						'else'      => array( array( 'kind' => 'wat' ) ),
					),
				),
			)
		);
		$this->assertWPError( $result );
		$this->assertStringContainsString( 'else', $result->get_error_message() );
	}

	// ---- Placeholder resolution + comparator -----------------------------

	/**
	 * @covers ::wpdm_routine_resolve
	 */
	public function test_resolve_single_placeholder_preserves_type() {
		$context = array( 'payload' => array( 'post_id' => 42 ), 'vars' => array() );
		$this->assertSame( 42, wpdm_routine_resolve( '{{payload.post_id}}', $context ) );
	}

	/**
	 * @covers ::wpdm_routine_resolve
	 */
	public function test_resolve_string_interpolation() {
		$context = array( 'payload' => array( 'name' => 'Daniel' ), 'vars' => array() );
		$this->assertSame( 'Hi Daniel!', wpdm_routine_resolve( 'Hi {{payload.name}}!', $context ) );
	}

	/**
	 * @covers ::wpdm_routine_resolve
	 */
	public function test_resolve_recurses_into_arrays() {
		$context = array( 'payload' => array( 'id' => 7 ), 'vars' => array() );
		$out     = wpdm_routine_resolve(
			array( 'a' => '{{payload.id}}', 'b' => array( 'c' => 'item-{{payload.id}}' ) ),
			$context
		);
		$this->assertSame( 7, $out['a'] );
		$this->assertSame( 'item-7', $out['b']['c'] );
	}

	/**
	 * @covers ::wpdm_routine_compare
	 */
	public function test_compare_operators() {
		$this->assertTrue( wpdm_routine_compare( 'hello world', 'contains', 'WORLD' ) );
		$this->assertTrue( wpdm_routine_compare( 5, 'gt', 3 ) );
		$this->assertFalse( wpdm_routine_compare( 5, 'gt', 'apple' ) ); // non-numeric right
		$this->assertTrue( wpdm_routine_compare( 'foobar', 'matches', '/foo/' ) );
		$this->assertTrue( wpdm_routine_compare( 'a', 'in', array( 'a', 'b', 'c' ) ) );
		$this->assertFalse( wpdm_routine_compare( 'd', 'in', array( 'a', 'b', 'c' ) ) );
		$this->assertTrue( wpdm_routine_compare( 1, 'truthy', null ) );
		$this->assertTrue( wpdm_routine_compare( 0, 'falsy', null ) );
	}

	// ---- CPT save/load ---------------------------------------------------

	/**
	 * @covers ::wpdm_routine_save
	 * @covers ::wpdm_routine_get
	 */
	public function test_save_and_read_round_trip() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'Test routine',
				'enabled' => true,
				'def'     => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array(
						array( 'kind' => 'log', 'args' => array( 'message' => 'hi' ) ),
					),
				),
			)
		);
		$this->assertIsInt( $id );

		$row = wpdm_routine_get( $id );
		$this->assertSame( 'Test routine', $row['title'] );
		$this->assertTrue( $row['enabled'] );
		$this->assertSame( 'publish_post', $row['def']['trigger']['id'] );
	}

	/**
	 * @covers ::wpdm_routine_save
	 */
	public function test_save_requires_manage_options() {
		wp_set_current_user( self::$author_id );
		$result = wpdm_routine_save(
			array(
				'title' => 'Sneaky',
				'def'   => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array(),
				),
			)
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_forbidden', $result->get_error_code() );
	}

	// ---- Executor end-to-end ---------------------------------------------

	/**
	 * @covers ::wpdm_routine_run
	 */
	public function test_runs_log_step_and_records_history() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'Logger',
				'enabled' => true,
				'def'     => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array(
						array( 'kind' => 'log', 'args' => array( 'level' => 'info', 'message' => 'hi {{payload.name}}' ) ),
					),
				),
			)
		);

		$result = wpdm_routine_run( $id, array( 'name' => 'Daniel' ), 'publish_post' );
		$this->assertSame( 'success', $result['status'] );
		$this->assertCount( 1, $result['steps_log'] );
		$this->assertSame( 'log', $result['steps_log'][0]['kind'] );
		$this->assertTrue( $result['steps_log'][0]['ok'] );

		// Persisted to history.
		$runs = wpdm_routine_get_runs( $id );
		$this->assertCount( 1, $runs );
		$this->assertSame( 'success', $runs[0]['status'] );
	}

	/**
	 * @covers ::wpdm_routine_run
	 */
	public function test_top_level_condition_skips_when_false() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'Conditional',
				'enabled' => true,
				'def'     => array(
					'trigger'    => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'conditions' => array(
						array( 'left' => '{{payload.type}}', 'op' => 'eq', 'right' => 'post' ),
					),
					'steps'      => array(
						array( 'kind' => 'log', 'args' => array( 'message' => 'should not run' ) ),
					),
				),
			)
		);
		$result = wpdm_routine_run( $id, array( 'type' => 'page' ), 'publish_post' );
		$this->assertSame( 'skipped', $result['status'] );
	}

	/**
	 * @covers ::wpdm_routine_walk_steps
	 */
	public function test_if_branch_routes_correctly() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'Branching',
				'enabled' => true,
				'def'     => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array(
						array(
							'kind'      => 'if',
							'condition' => array( 'left' => '{{payload.value}}', 'op' => 'gt', 'right' => 10 ),
							'then'      => array(
								array( 'kind' => 'set_var', 'args' => array( 'name' => 'branch', 'value' => 'big' ) ),
							),
							'else'      => array(
								array( 'kind' => 'set_var', 'args' => array( 'name' => 'branch', 'value' => 'small' ) ),
							),
						),
					),
				),
			)
		);

		$big = wpdm_routine_run( $id, array( 'value' => 100 ), '' );
		$this->assertSame( 'success', $big['status'] );
		$this->assertSame( 'then', $big['steps_log'][0]['branch'] );

		$small = wpdm_routine_run( $id, array( 'value' => 1 ), '' );
		$this->assertSame( 'success', $small['status'] );
		$this->assertSame( 'else', $small['steps_log'][0]['branch'] );
	}

	/**
	 * @covers ::wpdm_routine_run
	 */
	public function test_dry_run_does_not_persist_history() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'Dry',
				'enabled' => true,
				'def'     => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array(
						array( 'kind' => 'log', 'args' => array( 'message' => 'x' ) ),
					),
				),
			)
		);
		$result = wpdm_routine_run( $id, array(), 'test', true );
		$this->assertSame( 'success', $result['status'] );
		$this->assertCount( 0, wpdm_routine_get_runs( $id ) );
	}

	/**
	 * @covers ::wpdm_routine_run
	 */
	public function test_disabled_routine_is_skipped() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'Off',
				'enabled' => false,
				'def'     => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array( array( 'kind' => 'log', 'args' => array( 'message' => 'x' ) ) ),
				),
			)
		);
		$result = wpdm_routine_run( $id, array(), 'publish_post' );
		$this->assertSame( 'skipped', $result['status'] );
		$this->assertSame( 'routine_disabled', $result['error'] );
	}

	/**
	 * @covers ::wpdm_routine_run
	 */
	public function test_can_run_filter_blocks_execution() {
		wp_set_current_user( self::$admin_id );
		$id = wpdm_routine_save(
			array(
				'title'   => 'GateCheck',
				'enabled' => true,
				'def'     => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array( array( 'kind' => 'log', 'args' => array( 'message' => 'x' ) ) ),
				),
			)
		);

		add_filter( 'desktop_mode_routine_can_run', '__return_false' );
		$result = wpdm_routine_run( $id, array(), '' );
		remove_filter( 'desktop_mode_routine_can_run', '__return_false' );

		$this->assertSame( 'skipped', $result['status'] );
		$this->assertSame( 'gate_denied', $result['error'] );
	}

	// ---- HTTP step allowlist ---------------------------------------------

	/**
	 * @covers ::wpdm_routine_step_http
	 */
	public function test_http_step_blocks_unlisted_host_by_default() {
		$result = wpdm_routine_step_http(
			array( 'url' => 'https://example.com/hook', 'method' => 'GET' ),
			array( 'routine_id' => 0, 'run_as_user_id' => self::$admin_id, 'payload' => array(), 'vars' => array() )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_step_http_host_blocked', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdm_routine_step_http
	 */
	public function test_http_step_rejects_non_http_scheme() {
		add_filter( 'desktop_mode_routine_http_allowlist', static fn() => array( '*' ) );
		$result = wpdm_routine_step_http(
			array( 'url' => 'file:///etc/passwd' ),
			array( 'routine_id' => 0, 'run_as_user_id' => self::$admin_id, 'payload' => array(), 'vars' => array() )
		);
		remove_all_filters( 'desktop_mode_routine_http_allowlist' );
		$this->assertWPError( $result );
	}

	// ---- Registration API -------------------------------------------------

	/**
	 * @covers ::desktop_mode_register_routine_trigger
	 */
	public function test_trigger_registration_validates_id() {
		$this->assertWPError( desktop_mode_register_routine_trigger( array( 'id' => '', 'label' => 'X' ) ) );
		$this->assertWPError( desktop_mode_register_routine_trigger( array( 'id' => 'ok', 'label' => '' ) ) );
		$this->assertTrue( desktop_mode_register_routine_trigger( array( 'id' => 'my_trigger', 'label' => 'Mine' ) ) );

		$entry = wpdm_routine_trigger_registry( 'my_trigger' );
		$this->assertSame( 'Mine', $entry['label'] );
	}

	/**
	 * @covers ::desktop_mode_register_routine_action
	 */
	public function test_action_registration_requires_handler() {
		$this->assertWPError(
			desktop_mode_register_routine_action(
				array( 'id' => 'my.action', 'label' => 'Mine' )
			)
		);
		$this->assertTrue(
			desktop_mode_register_routine_action(
				array(
					'id'      => 'my.action',
					'label'   => 'Mine',
					'handler' => '__return_true',
				)
			)
		);
	}

	/**
	 * @covers ::desktop_mode_register_routine_template
	 */
	public function test_template_registration_validates_def() {
		$this->assertWPError(
			desktop_mode_register_routine_template(
				array( 'id' => 'tpl', 'title' => 'X', 'def' => 'not an array' )
			)
		);
		$ok = desktop_mode_register_routine_template(
			array(
				'id'    => 'tpl-good',
				'title' => 'Good',
				'def'   => array(
					'trigger' => array( 'kind' => 'hook', 'id' => 'publish_post' ),
					'steps'   => array(),
				),
			)
		);
		$this->assertTrue( $ok );
		$entry = wpdm_routine_template_registry( 'tpl-good' );
		$this->assertSame( 'Good', $entry['title'] );
	}

	// ---- Classify step ---------------------------------------------------

	/**
	 * @covers ::wpdm_routine_known_step_kinds
	 */
	public function test_classify_kind_is_registered() {
		$this->assertContains( 'classify', wpdm_routine_known_step_kinds() );
	}

	/**
	 * @covers ::wpdm_routine_validate_step
	 */
	public function test_classify_step_validates() {
		$result = wpdm_routine_validate_def(
			array(
				'trigger' => array( 'kind' => 'hook', 'id' => 'comment_post' ),
				'steps'   => array(
					array(
						'kind' => 'classify',
						'id'   => 'spam_check',
						'args' => array(
							'input'   => '{{payload.comment.content}}',
							'buckets' => array(
								array( 'id' => 'spam', 'description' => 'Spam' ),
								array( 'id' => 'ham', 'description' => 'Legit' ),
							),
						),
					),
				),
			)
		);
		$this->assertIsArray( $result );
		$this->assertSame( 'classify', $result['steps'][0]['kind'] );
	}

	/**
	 * @covers ::wpdm_routine_step_classify
	 */
	public function test_classify_rejects_empty_input() {
		$result = wpdm_routine_step_classify(
			array( 'input' => '', 'buckets' => array(
				array( 'id' => 'a', 'description' => '' ),
				array( 'id' => 'b', 'description' => '' ),
			) ),
			array( 'run_as_user_id' => self::$admin_id )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_step_classify_empty_input', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdm_routine_step_classify
	 */
	public function test_classify_rejects_too_few_buckets() {
		$result = wpdm_routine_step_classify(
			array(
				'input'   => 'something',
				'buckets' => array(
					array( 'id' => 'only_one', 'description' => '' ),
				),
			),
			array( 'run_as_user_id' => self::$admin_id )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_step_classify_buckets', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdm_routine_step_classify
	 */
	public function test_classify_drops_buckets_with_invalid_ids() {
		// Buckets with non-`[a-z0-9_-]` ids are silently filtered;
		// the step must still surface the "too few" error rather
		// than calling OpenAI with a bad enum.
		$result = wpdm_routine_step_classify(
			array(
				'input'   => 'foo',
				'buckets' => array(
					array( 'id' => 'good', 'description' => '' ),
					array( 'id' => 'bad id with spaces', 'description' => '' ),
				),
			),
			array( 'run_as_user_id' => self::$admin_id )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_routine_step_classify_buckets', $result->get_error_code() );
	}

	// ---- AI generation ---------------------------------------------------

	/**
	 * @covers ::wpdm_routine_ai_def_schema
	 */
	public function test_ai_schema_exposes_strict_shape_with_required_fields() {
		$schema = wpdm_routine_ai_def_schema();
		$this->assertSame( 'object', $schema['type'] );
		$this->assertFalse( $schema['additionalProperties'] );
		$this->assertContains( 'trigger', $schema['required'] );
		$this->assertContains( 'steps', $schema['required'] );
		$this->assertContains( 'run_as', $schema['required'] );
		// run_as is enum-restricted to author/system.
		$this->assertSame(
			array( 'author', 'system' ),
			$schema['properties']['run_as']['enum']
		);
		// Steps reference the recursive Step definition.
		$this->assertSame( '#/$defs/Step', $schema['properties']['steps']['items']['$ref'] );
		// Step's `kind` enum matches the validator's known kinds.
		$this->assertSame(
			wpdm_routine_known_step_kinds(),
			$schema['$defs']['Step']['properties']['kind']['enum']
		);
	}

	/**
	 * @covers ::wpdm_routine_ai_extract_json
	 */
	public function test_ai_extract_json_handles_output_text_shorthand() {
		$result = wpdm_routine_ai_extract_json(
			array( 'output_text' => '{"version":1,"trigger":{"kind":"hook","id":"publish_post"}}' )
		);
		$this->assertIsArray( $result );
		$this->assertSame( 1, $result['version'] );
	}

	/**
	 * @covers ::wpdm_routine_ai_extract_json
	 */
	public function test_ai_extract_json_walks_nested_output_blocks() {
		$result = wpdm_routine_ai_extract_json(
			array(
				'output' => array(
					array(
						'content' => array(
							array(
								'type' => 'output_text',
								'text' => '{"x":1}',
							),
						),
					),
				),
			)
		);
		$this->assertSame( array( 'x' => 1 ), $result );
	}

	/**
	 * @covers ::wpdm_routine_ai_extract_json
	 */
	public function test_ai_extract_json_errors_on_missing_text() {
		$result = wpdm_routine_ai_extract_json( array( 'output' => array() ) );
		$this->assertWPError( $result );
	}

	/**
	 * @covers ::wpdm_routine_ai_postprocess_def
	 */
	public function test_ai_postprocess_decodes_step_args_strings() {
		$raw = array(
			'version' => 1,
			'steps'   => array(
				array(
					'kind' => 'log',
					'id'   => '',
					// AI emits args as a JSON-encoded string —
					// strict-mode constraint.
					'args' => '{"message":"hi","level":"info"}',
				),
				array(
					'kind' => 'if',
					'id'   => '',
					'args' => '{}',
					'condition' => array( 'left' => '1', 'op' => 'eq', 'right' => '1' ),
					'then' => array(
						array(
							'kind' => 'log',
							'id'   => '',
							'args' => '{"message":"branch"}',
						),
					),
					'else' => array(),
				),
			),
		);
		$out = wpdm_routine_ai_postprocess_def( $raw );
		$this->assertSame(
			array( 'message' => 'hi', 'level' => 'info' ),
			$out['steps'][0]['args']
		);
		$this->assertSame( array(), $out['steps'][1]['args'] );
		$this->assertSame(
			array( 'message' => 'branch' ),
			$out['steps'][1]['then'][0]['args']
		);
	}

	/**
	 * @covers ::wpdm_routine_ai_postprocess_def
	 */
	public function test_ai_postprocess_falls_back_on_invalid_json_args() {
		$out = wpdm_routine_ai_postprocess_def(
			array(
				'steps' => array(
					array(
						'kind' => 'log',
						'id'   => '',
						'args' => 'not valid json',
					),
				),
			)
		);
		$this->assertSame( array(), $out['steps'][0]['args'] );
	}

	/**
	 * @covers ::wpdm_routine_ai_extract_json
	 */
	public function test_ai_extract_json_errors_on_malformed() {
		$result = wpdm_routine_ai_extract_json(
			array( 'output_text' => 'not json' )
		);
		$this->assertWPError( $result );
	}

	/**
	 * @covers ::wpdm_routine_ai_build_catalog
	 */
	public function test_ai_catalog_contains_seeded_triggers_and_actions() {
		$catalog = wpdm_routine_ai_build_catalog( self::$admin_id );
		$trigger_ids = array_column( $catalog['triggers'], 'id' );
		$this->assertContains( 'publish_post', $trigger_ids );
		$this->assertContains( 'wp_login', $trigger_ids );
		$this->assertContains( 'wp_login_failed', $trigger_ids );

		$action_ids = array_column( $catalog['actions'], 'id' );
		$this->assertContains( 'wpdm.comment.trash', $action_ids );
		$this->assertContains( 'wpdm.post.publish', $action_ids );
		$this->assertContains( 'wpdm.broadcast', $action_ids );
		$this->assertContains( 'wpdm.user.update_role', $action_ids );
	}

	// ---- New built-in actions --------------------------------------------

	/**
	 * @covers ::wpdm_routine_action_post_publish
	 */
	public function test_action_post_publish_sets_status() {
		wp_set_current_user( self::$admin_id );
		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$result  = wpdm_routine_action_post_publish(
			array( 'post_id' => $post_id ),
			array( 'run_as_user_id' => self::$admin_id )
		);
		$this->assertIsArray( $result );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * @covers ::wpdm_routine_action_comment_approve
	 */
	public function test_action_comment_approve_moves_pending_to_approved() {
		wp_set_current_user( self::$admin_id );
		$post_id    = self::factory()->post->create();
		$comment_id = self::factory()->comment->create(
			array( 'comment_post_ID' => $post_id, 'comment_approved' => 0 )
		);
		$result = wpdm_routine_action_comment_approve(
			array( 'comment_id' => $comment_id ),
			array()
		);
		$this->assertTrue( $result['approved'] );
		$this->assertSame( '1', get_comment( $comment_id )->comment_approved );
	}

	/**
	 * @covers ::wpdm_routine_action_user_update_role
	 */
	public function test_action_user_update_role_replaces_role() {
		wp_set_current_user( self::$admin_id );
		$result = wpdm_routine_action_user_update_role(
			array( 'user_id' => self::$author_id, 'role' => 'editor' ),
			array()
		);
		$this->assertSame( 'editor', $result['role'] );
		$user = get_user_by( 'id', self::$author_id );
		$this->assertContains( 'editor', $user->roles );
	}

	/**
	 * @covers ::wpdm_routine_action_broadcast
	 */
	public function test_action_broadcast_fires_meta_action() {
		$received = array();
		add_action(
			'desktop_mode_broadcast_received',
			function ( $topic, $payload ) use ( &$received ) {
				$received[] = array( 'topic' => $topic, 'payload' => $payload );
			},
			10,
			2
		);
		$result = wpdm_routine_action_broadcast(
			array( 'topic' => 'test/event', 'payload' => array( 'foo' => 'bar' ) ),
			array()
		);
		remove_all_filters( 'desktop_mode_broadcast_received' );
		$this->assertSame( 'test/event', $result['topic'] );
		$this->assertSame( 'test/event', $received[0]['topic'] );
		$this->assertSame( array( 'foo' => 'bar' ), $received[0]['payload'] );
	}

	/**
	 * @covers ::wpdm_routine_action_option_update
	 */
	public function test_action_option_update_writes_option() {
		wp_set_current_user( self::$admin_id );
		$result = wpdm_routine_action_option_update(
			array( 'option' => 'wpdm_test_option', 'value' => 'hello' ),
			array()
		);
		$this->assertSame( 'wpdm_test_option', $result['option'] );
		$this->assertSame( 'hello', get_option( 'wpdm_test_option' ) );
	}

	/**
	 * @covers ::wpdm_routine_action_comment_trash
	 */
	public function test_built_in_comment_trash_action() {
		wp_set_current_user( self::$admin_id );
		$post_id    = self::factory()->post->create();
		$comment_id = self::factory()->comment->create( array( 'comment_post_ID' => $post_id, 'comment_approved' => 1 ) );

		$result = wpdm_routine_action_comment_trash(
			array( 'comment_id' => $comment_id ),
			array( 'routine_id' => 0, 'run_as_user_id' => self::$admin_id, 'payload' => array(), 'vars' => array() )
		);
		$this->assertSame( $comment_id, $result['comment_id'] );
		$this->assertTrue( $result['trashed'] );

		$comment = get_comment( $comment_id );
		$this->assertSame( 'trash', $comment->comment_approved );
	}
}
