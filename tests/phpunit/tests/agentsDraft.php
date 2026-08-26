<?php
/**
 * Tests for drafting an agent from a brief: the `/agents/draft` route,
 * the pre-filter seam, and the catalogue filtering that stands between
 * whatever a model says and what the wizard is handed.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsDraft extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_agent_draft' );
		parent::tear_down();
	}

	private function request( $brief ) {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/agents/draft' );
		$req->set_param( 'brief', $brief );
		return $req;
	}

	/** A pre-filter that answers with a fixed draft, as a provider would. */
	private function stub_draft( array $draft ) {
		add_filter(
			'openstation_agent_draft',
			static function () use ( $draft ) {
				return $draft;
			}
		);
	}

	/**
	 * @covers ::openstation_agents_rest_draft
	 * @covers ::openstation_agent_draft
	 */
	public function test_draft_round_trip_through_the_pre_filter() {
		$this->stub_draft(
			array(
				'name'         => 'Categorizer',
				'description'  => 'Files posts under the right categories.',
				'vibes'        => 'tidy, decisive',
				'instructions' => "Read each post.\nPick categories that fit.",
				'role'         => 'editor',
				'abilities'    => array( 'desktop-mode/get-post' ),
			)
		);

		$response = openstation_agents_rest_draft( $this->request( 'I want an agent to add categories to my posts' ) );
		$this->assertNotWPError( $response );
		$data = $response->get_data();

		$this->assertSame( 'Categorizer', $data['name'] );
		$this->assertSame( 'Files posts under the right categories.', $data['description'] );
		$this->assertSame( 'tidy, decisive', $data['vibes'] );
		$this->assertSame( "Read each post.\nPick categories that fit.", $data['instructions'] );
		$this->assertSame( 'editor', $data['role'] );
		$this->assertSame( array( 'desktop-mode/get-post' ), $data['abilities'] );
	}

	/**
	 * The catalogues are the authority: a role the site does not allow
	 * and an ability it does not register are dropped, not trusted.
	 *
	 * @covers ::openstation_agent_draft_sanitize
	 */
	public function test_unknown_role_and_abilities_are_dropped() {
		$this->stub_draft(
			array(
				'name'         => 'Overreach',
				'description'  => '',
				'vibes'        => str_repeat( 'x', 200 ),
				'instructions' => 'Do things.',
				'role'         => 'administrator-plus',
				'abilities'    => array( 'desktop-mode/get-post', 'evil/delete-everything', 'desktop-mode/get-post', 42 ),
			)
		);

		$data = openstation_agents_rest_draft( $this->request( 'anything' ) )->get_data();

		$this->assertSame( '', $data['role'] );
		$this->assertSame( array( 'desktop-mode/get-post' ), $data['abilities'] );
		$this->assertSame( 120, mb_strlen( $data['vibes'] ) );
	}

	/**
	 * The pre-filter receives the brief and both catalogues, so an
	 * alternative runtime can build the same prompt the AI Client gets.
	 *
	 * @covers ::openstation_agent_draft
	 */
	public function test_pre_filter_receives_brief_roles_and_catalogue() {
		$seen = array();
		add_filter(
			'openstation_agent_draft',
			static function ( $draft, $brief, $roles, $catalogue, $user_id ) use ( &$seen ) {
				$seen = compact( 'brief', 'roles', 'catalogue', 'user_id' );
				return array( 'name' => 'Seen' );
			},
			10,
			5
		);

		openstation_agents_rest_draft( $this->request( '  Watch my drafts.  ' ) );

		$this->assertSame( 'Watch my drafts.', $seen['brief'] );
		$this->assertContains( 'author', $seen['roles'] );
		$this->assertContains( 'desktop-mode/get-post', wp_list_pluck( $seen['catalogue'], 'slug' ) );
		$this->assertSame( self::$admin_id, $seen['user_id'] );
	}

	/**
	 * Without the AI Client and without a pre-filter there is nothing
	 * to draft with, and the route says so rather than 500ing.
	 *
	 * @covers ::openstation_agent_draft
	 */
	public function test_unavailable_ai_is_a_503() {
		if ( function_exists( 'openstation_ai_is_available' ) && openstation_ai_is_available() ) {
			$this->markTestSkipped( 'An AI Client is present in this environment.' );
		}
		$result = openstation_agents_rest_draft( $this->request( 'Summarise things.' ) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_ai_unavailable', $result->get_error_code() );
		$this->assertSame( 503, $result->get_error_data()['status'] );
	}

	/**
	 * An empty or oversized brief never reaches generation.
	 *
	 * @covers ::openstation_agents_rest_validate_brief
	 */
	public function test_brief_validation() {
		$this->assertFalse( openstation_agents_rest_validate_brief( '' ) );
		$this->assertFalse( openstation_agents_rest_validate_brief( "   \n" ) );
		$this->assertFalse( openstation_agents_rest_validate_brief( str_repeat( 'a', OPENSTATION_AGENT_DRAFT_BRIEF_MAX + 1 ) ) );
		$this->assertTrue( openstation_agents_rest_validate_brief( 'Categorizer' ) );
		$this->assertFalse( openstation_agents_rest_validate_brief( array( 'not', 'a', 'string' ) ) );
	}

	/**
	 * Drafting is part of creating, so it takes the create permission.
	 *
	 * @covers ::openstation_agents_rest_write_permission
	 */
	public function test_editor_cannot_draft() {
		wp_set_current_user( self::$editor_id );
		$this->assertWPError( openstation_agents_rest_write_permission( $this->request( 'x' ) ) );
	}

	/**
	 * The schema only declares enums it can fill; an empty enum is a
	 * schema no provider accepts.
	 *
	 * @covers ::openstation_agent_draft_answer_schema
	 */
	public function test_answer_schema_enums_follow_the_catalogues() {
		$schema = openstation_agent_draft_answer_schema( array( 'author', 'editor' ), array( 'a/b' ) );
		$this->assertSame( array( 'author', 'editor' ), $schema['properties']['role']['enum'] );
		$this->assertSame( array( 'a/b' ), $schema['properties']['abilities']['items']['enum'] );
		$this->assertFalse( $schema['additionalProperties'] );

		$bare = openstation_agent_draft_answer_schema( array(), array() );
		$this->assertArrayNotHasKey( 'enum', $bare['properties']['role'] );
		$this->assertArrayNotHasKey( 'enum', $bare['properties']['abilities']['items'] );
	}
}
