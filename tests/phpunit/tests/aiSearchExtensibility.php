<?php

class Tests_OpenStation_AiSearchExtensibility extends WP_UnitTestCase {

	public function tear_down() {

		remove_all_filters( 'openstation_ai_system_prompt_appendix' );
		remove_all_filters( 'openstation_ai_system_prompt_replace_capability' );
		remove_all_filters( 'openstation_ai_system_prompt' );
		remove_all_filters( 'openstation_ai_command_allowed' );
		remove_all_filters( 'openstation_ai_tool_result' );
		remove_all_filters( 'openstation_ai_answer' );
		parent::tear_down();
	}

	public function test_core_instructions_pass_through_when_nothing_extends() {
		$out = openstation_ai_compose_instructions( 'CORE', array( 'user_id' => 1 ) );
		$this->assertSame( 'CORE', $out );
	}

	public function test_appendix_filter_stacks_onto_core() {
		add_filter( 'openstation_ai_system_prompt_appendix', static function () {
			return 'APPENDIX';
		} );
		$out = openstation_ai_compose_instructions( 'CORE', array( 'user_id' => 1 ) );
		$this->assertSame( "CORE\n\nAPPENDIX", $out );
	}

	public function test_client_append_concatenates() {
		$out = openstation_ai_compose_instructions(
			'CORE',
			array( 'user_id' => 1 ),
			array( 'text' => 'CLIENT', 'mode' => 'append' )
		);
		$this->assertSame( "CORE\n\nCLIENT", $out );
	}

	public function test_client_replace_from_admin_replaces_everything() {
		$admin = $this->factory()->user->create( array( 'role' => 'administrator' ) );
		add_filter( 'openstation_ai_system_prompt_appendix', static function () {
			return 'WOULD_BE_IGNORED';
		} );
		$out = openstation_ai_compose_instructions(
			'CORE',
			array( 'user_id' => $admin ),
			array( 'text' => 'REPLACEMENT', 'mode' => 'replace' )
		);
		$this->assertSame( 'REPLACEMENT', $out );
	}

	public function test_client_replace_from_non_admin_silently_downgrades_to_append() {
		$subscriber = $this->factory()->user->create( array( 'role' => 'subscriber' ) );
		$out        = openstation_ai_compose_instructions(
			'CORE',
			array( 'user_id' => $subscriber ),
			array( 'text' => 'DOWNGRADED', 'mode' => 'replace' )
		);

		$this->assertSame( "CORE\n\nDOWNGRADED", $out );
	}

	public function test_replace_capability_filter_can_loosen_gate() {
		$subscriber = $this->factory()->user->create( array( 'role' => 'subscriber' ) );

		add_filter( 'openstation_ai_system_prompt_replace_capability', static function () {
			return 'read';
		} );
		$out = openstation_ai_compose_instructions(
			'CORE',
			array( 'user_id' => $subscriber ),
			array( 'text' => 'REPLACEMENT', 'mode' => 'replace' )
		);
		$this->assertSame( 'REPLACEMENT', $out );
	}

	public function test_final_transform_filter_runs_last() {
		add_filter( 'openstation_ai_system_prompt_appendix', static function () {
			return 'APPENDIX';
		} );
		add_filter( 'openstation_ai_system_prompt', static function ( $s ) {
			return $s . "\n---\nDISCLAIMER";
		} );
		$out = openstation_ai_compose_instructions( 'CORE', array( 'user_id' => 1 ) );
		$this->assertSame( "CORE\n\nAPPENDIX\n---\nDISCLAIMER", $out );
	}

	public function test_appendix_filter_receives_context_shape() {
		$captured = null;
		add_filter( 'openstation_ai_system_prompt_appendix', static function ( $a, $ctx ) use ( &$captured ) {
			$captured = $ctx;
			return $a;
		}, 10, 2 );

		openstation_ai_compose_instructions(
			'CORE',
			array(
				'query'      => 'what is the weather?',
				'user_id'    => 42,
				'request_id' => 'abc-123',
				'phase'      => 'follow_up',
			),
			array( 'text' => 'X', 'mode' => 'append' )
		);

		$this->assertIsArray( $captured );
		$this->assertSame( 'what is the weather?', $captured['query'] );
		$this->assertSame( 42, $captured['user_id'] );
		$this->assertSame( 'abc-123', $captured['request_id'] );
		$this->assertSame( 'follow_up', $captured['phase'] );
		$this->assertSame( 'append', $captured['client_override'] );
	}

	public function test_client_override_context_is_null_when_no_client_text() {
		$captured = null;
		add_filter( 'openstation_ai_system_prompt_appendix', static function ( $a, $ctx ) use ( &$captured ) {
			$captured = $ctx;
			return $a;
		}, 10, 2 );

		openstation_ai_compose_instructions( 'CORE', array( 'user_id' => 1 ) );

		$this->assertNull( $captured['client_override'] );
	}

	public function test_command_allowed_filter_exists_in_core_flow() {
		$fired = 0;
		add_filter( 'openstation_ai_command_allowed', static function ( $entry, $slug, $ctx ) use ( &$fired ) {
			$fired++;
			return $entry;
		}, 10, 3 );

		$r = apply_filters(
			'openstation_ai_command_allowed',
			array( 'slug' => 'x', 'label' => 'X' ),
			'x',
			array( 'user_id' => 1, 'request_id' => 'r' )
		);
		$this->assertSame( 1, $fired );
		$this->assertSame( array( 'slug' => 'x', 'label' => 'X' ), $r );
	}
}
