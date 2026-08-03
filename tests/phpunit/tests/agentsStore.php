<?php
/**
 * Tests for the agents definition store — user-meta CRUD, sanitizers,
 * catalogues, and the create/update orchestrators with their audit
 * actions.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsStore extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function create_agent( array $overrides = array() ) {
		$user = open_station_agent_create(
			array_merge(
				array(
					'name'         => 'Test Agent',
					'role'         => 'author',
					'description'  => 'Reviews drafts.',
					'instructions' => 'You review drafts and tighten headings.',
					'abilities'    => array( 'desktop-mode/get-post' ),
				),
				$overrides
			)
		);
		$this->assertNotWPError( $user );
		return $user;
	}

	/**
	 * @covers ::open_station_agent_create
	 */
	public function test_create_writes_definition_meta() {
		$user = $this->create_agent();

		$this->assertTrue( open_station_agent_is_agent( $user ) );
		$this->assertSame( 'Reviews drafts.', open_station_agent_get_description( $user->ID ) );
		$this->assertSame(
			'You review drafts and tighten headings.',
			open_station_agent_get_instructions( $user->ID )
		);
		$this->assertSame( array( 'desktop-mode/get-post' ), open_station_agent_get_abilities( $user->ID ) );
		$this->assertSame(
			self::$admin_id,
			(int) get_user_meta( $user->ID, OPEN_STATION_AGENT_CREATED_BY_META, true )
		);
	}

	/**
	 * Abilities land on disk as a JSON string, not a PHP-serialized array.
	 *
	 * @covers ::open_station_agent_create
	 */
	public function test_abilities_meta_is_json_encoded() {
		$user = $this->create_agent();
		$raw  = get_user_meta( $user->ID, OPEN_STATION_AGENT_ABILITIES_META, true );
		$this->assertIsString( $raw );
		$this->assertSame( array( 'desktop-mode/get-post' ), json_decode( $raw, true ) );
	}

	/**
	 * @covers ::open_station_agent_create
	 */
	public function test_create_fires_created_action() {
		$captured = array();
		add_action(
			'open_station_agent_created',
			static function ( $user_id, $args, $actor_id ) use ( &$captured ) {
				$captured = array( $user_id, $args, $actor_id );
			},
			10,
			3
		);

		$user = $this->create_agent();

		$this->assertSame( (int) $user->ID, $captured[0] );
		$this->assertSame( 'Test Agent', $captured[1]['name'] );
		$this->assertSame( 'author', $captured[1]['role'] );
		$this->assertSame( self::$admin_id, $captured[2] );
	}

	/**
	 * @covers ::open_station_agent_create
	 */
	public function test_create_rejects_role_outside_whitelist() {
		$result = open_station_agent_create(
			array(
				'name' => 'Sneaky',
				'role' => 'subscriber',
			)
		);
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_agent_invalid_role', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_agent_update
	 */
	public function test_update_applies_fields_and_fires_audit_action() {
		$user = $this->create_agent();

		$captured = null;
		add_action(
			'open_station_agent_updated',
			static function ( $user_id, $changed, $actor_id ) use ( &$captured ) {
				$captured = array( $user_id, $changed, $actor_id );
			},
			10,
			3
		);

		$result = open_station_agent_update(
			$user->ID,
			array(
				'instructions' => 'New prompt.',
				'role'         => 'editor',
				'rateLimit'    => 5,
			)
		);
		$this->assertTrue( $result );

		$this->assertSame( 'New prompt.', open_station_agent_get_instructions( $user->ID ) );
		$this->assertSame( 5, open_station_agent_get_rate_limit( $user->ID ) );
		$fresh = get_userdata( $user->ID );
		$this->assertContains( 'editor', (array) $fresh->roles );

		$this->assertNotNull( $captured );
		$this->assertSame( (int) $user->ID, $captured[0] );
		$changed = $captured[1];
		$this->assertArrayHasKey( 'instructions', $changed );
		$this->assertSame( 'You review drafts and tighten headings.', $changed['instructions']['from'] );
		$this->assertSame( 'New prompt.', $changed['instructions']['to'] );
		$this->assertArrayHasKey( 'role', $changed );
		$this->assertArrayHasKey( 'rateLimit', $changed );
	}

	/**
	 * A no-op update (same values) must not fire the audit action.
	 *
	 * @covers ::open_station_agent_update
	 */
	public function test_noop_update_fires_no_action() {
		$user  = $this->create_agent();
		$fired = 0;
		add_action(
			'open_station_agent_updated',
			static function () use ( &$fired ) {
				++$fired;
			}
		);

		open_station_agent_update( $user->ID, array( 'description' => 'Reviews drafts.' ) );
		$this->assertSame( 0, $fired );
	}

	/**
	 * @covers ::open_station_agent_update
	 */
	public function test_update_rejects_non_agent_user() {
		$result = open_station_agent_update( self::$admin_id, array( 'name' => 'Nope' ) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_agent_not_found', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_agent_sanitize_triggers
	 */
	public function test_sanitize_triggers_drops_unknown_kinds_and_keeps_camel_case() {
		$clean = open_station_agent_sanitize_triggers(
			array(
				array(
					'kind'   => 'send-to',
					'config' => array( 'entityKinds' => array( 'post', 'media' ) ),
				),
				array(
					'kind'   => 'made-up-kind',
					'config' => array(),
				),
				'not-a-row',
			)
		);

		$this->assertCount( 1, $clean );
		$this->assertSame( 'send-to', $clean[0]['kind'] );
		$this->assertSame( array( 'post', 'media' ), $clean[0]['config']['entityKinds'] );
	}

	/**
	 * @covers ::open_station_agent_get_triggers
	 */
	public function test_triggers_round_trip_through_update() {
		$user = $this->create_agent();
		open_station_agent_update(
			$user->ID,
			array(
				'triggers' => array(
					array(
						'kind'   => 'chat',
						'config' => array( 'capability' => 'edit_posts' ),
					),
				),
			)
		);

		$triggers = open_station_agent_get_triggers( $user->ID );
		$this->assertCount( 1, $triggers );
		$this->assertSame( 'chat', $triggers[0]['kind'] );
		$this->assertSame( 'edit_posts', $triggers[0]['config']['capability'] );
	}

	/**
	 * @covers ::open_station_agents_sanitize_ability_slugs
	 */
	public function test_ability_slugs_are_deduped_and_stripped() {
		$this->assertSame(
			array( 'a/b', 'c/d' ),
			open_station_agents_sanitize_ability_slugs( array( 'a/b', 'a/b', '', 42, 'c/d' ) )
		);
	}

	/**
	 * @covers ::open_station_agent_allowed_roles
	 */
	public function test_allowed_roles_whitelist() {
		$roles = open_station_agent_allowed_roles();
		$this->assertContains( 'author', $roles );
		$this->assertContains( 'editor', $roles );
		$this->assertNotContains( 'subscriber', $roles );
	}

	/**
	 * @covers ::open_station_agent_get_agents
	 */
	public function test_get_agents_lists_only_agents() {
		$a = $this->create_agent( array( 'name' => 'Alpha' ) );
		$b = $this->create_agent( array( 'name' => 'Beta' ) );

		$ids = wp_list_pluck( open_station_agent_get_agents(), 'ID' );
		$this->assertContains( $a->ID, $ids );
		$this->assertContains( $b->ID, $ids );
		$this->assertNotContains( self::$admin_id, $ids );
	}

	/**
	 * @covers ::open_station_agents_enabled
	 */
	public function test_enabled_reads_extended_option() {
		remove_filter( 'open_station_agents_enabled', '__return_true' );
		$this->assertFalse( open_station_agents_enabled() );

		open_station_save_extended_options( array( 'agents' => true ) );
		$this->assertTrue( open_station_agents_enabled() );
	}
}
