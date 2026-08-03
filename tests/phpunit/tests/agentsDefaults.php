<?php
/**
 * Tests for the default agent roster — seeding on empty sites only,
 * idempotence, and complete definitions.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsDefaults extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		delete_option( OPEN_STATION_AGENTS_DEFAULTS_SEEDED_OPTION );
	}

	/**
	 * @covers ::open_station_agents_default_definitions
	 */
	public function test_definitions_are_complete() {
		$defs  = open_station_agents_default_definitions();
		$names = wp_list_pluck( $defs, 'name' );
		$this->assertSame(
			array( 'tl;dr', 'Comment Concierge', 'Localizer', 'SEO Medic', 'Alt Text Librarian' ),
			$names
		);
		foreach ( $defs as $def ) {
			$this->assertNotEmpty( $def['instructions'], "{$def['name']} needs instructions" );
			$this->assertNotEmpty( $def['abilities'], "{$def['name']} needs an ability allowlist" );
			$kinds = wp_list_pluck( $def['triggers'], 'kind' );
			$this->assertSame( array( 'chat', 'send-to', 'drag' ), $kinds, "{$def['name']} trigger kinds" );
		}
		// The Localizer can only draft — least privilege.
		$this->assertSame( 'author', $defs[2]['role'] );
	}

	/**
	 * @covers ::open_station_agents_seed_defaults
	 */
	public function test_seeds_on_an_agentless_site_once() {
		$this->assertCount( 0, open_station_agent_get_agents() );

		open_station_agents_seed_defaults();
		$agents = open_station_agent_get_agents();
		$this->assertCount( 5, $agents );
		$this->assertSame( '1', get_option( OPEN_STATION_AGENTS_DEFAULTS_SEEDED_OPTION ) );

		// Triggers landed on the user rows, not just in the definitions.
		$names = array();
		foreach ( $agents as $user ) {
			$names[] = $user->display_name;
			$triggers = json_decode( (string) get_user_meta( $user->ID, '_desktop_mode_agent_triggers', true ), true );
			$this->assertContains( 'send-to', wp_list_pluck( $triggers, 'kind' ) );
		}
		sort( $names );
		$this->assertSame(
			array( 'Alt Text Librarian', 'Comment Concierge', 'Localizer', 'SEO Medic', 'tl;dr' ),
			$names
		);

		// Idempotent: a second run creates nothing.
		open_station_agents_seed_defaults();
		$this->assertCount( 5, open_station_agent_get_agents() );
	}

	/**
	 * A site that already built its own roster is never touched — the
	 * flag is set without creating anything.
	 *
	 * @covers ::open_station_agents_seed_defaults
	 */
	public function test_never_seeds_into_an_existing_roster() {
		$own = open_station_agent_create(
			array(
				'name'         => 'Homegrown',
				'role'         => 'author',
				'instructions' => 'Mine.',
			)
		);
		$this->assertNotWPError( $own );

		open_station_agents_seed_defaults();
		$agents = open_station_agent_get_agents();
		$this->assertCount( 1, $agents );
		$this->assertSame( 'Homegrown', $agents[0]->display_name );
		$this->assertSame( '1', get_option( OPEN_STATION_AGENTS_DEFAULTS_SEEDED_OPTION ) );
	}
}
