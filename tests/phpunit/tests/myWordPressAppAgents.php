<?php

class Tests_OpenStation_MyWordPressAppAgents extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );

		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {

		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	private function disable_agents() {
		remove_all_filters( 'openstation_agents_enabled' );
		add_filter( 'openstation_agents_enabled', '__return_false' );
	}

	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'my-wordpress',
			array(
				'action' => $action,
				'state'  => array_merge( array( 'section' => 'agents' ), $state ),
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	protected function make_agent( $name = 'Test Agent' ) {
		$user = openstation_agent_create(
			array(
				'name' => $name,
				'role' => 'author',
			)
		);
		$this->assertNotWPError( $user );
		return $user;
	}

	protected function cast( array $over = array() ) {
		return array_merge(
			array(
				'brief'        => '',
				'name'         => 'Casey',
				'description'  => 'Watches the drafts.',
				'vibes'        => 'calm, thorough',
				'instructions' => 'Read the drafts and report.',
				'role'         => 'author',
				'abilities'    => array(),
				'triggers'     => array(
					array(
						'kind'   => 'chat',
						'config' => array(),
					),
				),
				'copiedFrom'   => '',
				'faceSeed'     => 7,
				'face'         => array(
					'appearance' => array( 'hueStart' => 44 ),
					'physics'    => array( 'shapePreset' => 'star' ),
				),
				'stripSeed'    => 7,
				'drafting'     => true,
			),
			$over
		);
	}

	public function test_the_agents_section_is_listed_for_a_reader() {
		$response = $this->dispatch( 'refresh', array( 'section' => '' ) );
		$ids      = wp_list_pluck( $response['data']['sections'], 'id' );

		$this->assertContains( 'agents', $ids );
		foreach ( $response['data']['sections'] as $section ) {
			if ( 'agents' === $section['id'] ) {
				$this->assertSame( 'agent', $section['kind'] );
				$this->assertNotEmpty( $section['icon'] );
			}
		}
	}

	public function test_the_agents_section_is_withheld_from_users_who_cannot_read_agents() {
		wp_set_current_user( self::$subscriber_id );

		$allow = static function ( $caps, $cap ) {
			if ( 'edit_posts' === $cap ) {
				return array( 'exist' );
			}
			return $caps;
		};
		add_filter( 'map_meta_cap', $allow, 10, 2 );
		add_filter( 'openstation_agents_user_can_read', '__return_false' );

		$response = $this->dispatch( 'refresh', array( 'section' => '' ) );
		$this->assertNotContains( 'agents', wp_list_pluck( $response['data']['sections'], 'id' ) );
	}

	public function test_the_agents_payload_only_ships_while_the_section_is_open() {
		$response = $this->dispatch( 'refresh', array( 'section' => 'posts' ) );
		$this->assertNull( $response['data']['agents'] );
		$this->assertNotNull( $response['data']['list'] );

		$response = $this->dispatch( 'refresh' );
		$this->assertIsArray( $response['data']['agents'] );
		$this->assertNull( $response['data']['list'], 'The agent section never runs WP_Query.' );
		$this->assertNull( $response['data']['detail'] );
	}

	public function test_the_payload_carries_the_cast_and_the_catalogues() {
		$agent    = $this->make_agent( 'Indexer' );
		$response = $this->dispatch( 'refresh' );
		$payload  = $response['data']['agents'];

		$this->assertTrue( $payload['enabled'] );
		$this->assertTrue( $payload['canManage'] );
		$this->assertTrue( $payload['canInvoke'] );
		$this->assertSame( 'desktop-mode-agent-run', $payload['runWindowId'] );
		$this->assertNotEmpty( $payload['restRoot'] );
		$this->assertNotEmpty( $payload['restNonce'] );

		$ids = wp_list_pluck( $payload['list'], 'id' );
		$this->assertContains( (int) $agent->ID, $ids );
		foreach ( $payload['list'] as $row ) {
			if ( (int) $agent->ID === $row['id'] ) {
				$this->assertSame( 'Indexer', $row['name'] );
				$this->assertSame( 'author', $row['role'] );
				$this->assertNotEmpty( $row['profileUrl'] );
				$this->assertArrayHasKey( 'triggers', $row );
				$this->assertArrayHasKey( 'faceSeed', $row );
			}
		}

		$this->assertNotEmpty( $payload['abilities'], 'The abilities catalogue ships with the data.' );
		$this->assertNotEmpty( $payload['triggerKinds'] );
		$this->assertNotEmpty( $payload['roleLabels'] );
		$this->assertIsArray( $payload['roles'], 'A manager gets the assignable-roles catalogue.' );
		$this->assertArrayNotHasKey( 'preview', $payload, 'The preview cast only ships while off.' );
	}

	public function test_a_reader_gets_labels_but_not_the_assignable_roles() {
		wp_set_current_user( self::$editor_id );
		$response = $this->dispatch( 'refresh' );
		$payload  = $response['data']['agents'];

		$this->assertFalse( $payload['canManage'] );
		$this->assertNull( $payload['roles'] );
		$this->assertNotEmpty( $payload['roleLabels'], 'Badges still resolve translated labels.' );
	}

	public function test_the_off_state_ships_the_preview_cast() {
		$this->disable_agents();
		$response = $this->dispatch( 'refresh' );
		$payload  = $response['data']['agents'];

		$this->assertFalse( $payload['enabled'] );
		$this->assertSame( array(), $payload['list'] );
		$this->assertSame( array(), $payload['abilities'] );
		$this->assertNotEmpty( $payload['preview'], 'The crew you would get, greyed and inert.' );
		foreach ( $payload['preview'] as $member ) {
			$this->assertArrayHasKey( 'name', $member );
			$this->assertArrayHasKey( 'roleLabel', $member );
			$this->assertArrayHasKey( 'face', $member );
		}
	}

	public function test_agent_create_builds_the_agent_from_the_cast() {
		$response = $this->dispatch(
			'agent-create',
			array(
				'casting' => true,
				'wstep'   => 4,
				'cast'    => $this->cast(),
			)
		);

		$this->assertTrue( $response['ok'] );
		$this->assertFalse( $response['state']['casting'], 'The wizard closes onto the new agent.' );
		$this->assertNull( $response['state']['cast'] );
		$created = $response['state']['item'];
		$this->assertGreaterThan( 0, $created );

		$user = get_userdata( $created );
		$this->assertTrue( openstation_agent_is_agent( $user ) );
		$this->assertSame( 'Casey', $user->display_name );
		$this->assertSame( 'calm, thorough', openstation_agent_get_vibes( $created ) );
		$this->assertSame( 7, openstation_agent_get_face_seed( $created ) );

		$rows = wp_list_pluck( $response['data']['agents']['list'], 'id' );
		$this->assertContains( $created, $rows, 'The fresh data already carries the new agent.' );
	}

	public function test_agent_create_requires_a_name() {
		$response = $this->dispatch(
			'agent-create',
			array(
				'casting' => true,
				'wstep'   => 4,
				'cast'    => $this->cast( array( 'name' => '   ' ) ),
			)
		);

		$this->assertTrue( $response['state']['casting'], 'The wizard stays open.' );
		$this->assertSame( 1, $response['state']['wstep'], 'Back to Meet, where the name lives.' );
		$this->assertNotSame( '', $response['state']['agentNotice'] );
	}

	public function test_agent_create_is_refused_without_the_manage_capability() {
		wp_set_current_user( self::$editor_id );
		$before   = count( openstation_agent_get_agents() );
		$response = $this->dispatch(
			'agent-create',
			array(
				'casting' => true,
				'cast'    => $this->cast(),
			)
		);

		$this->assertTrue( $response['ok'] );
		$this->assertCount( $before, openstation_agent_get_agents(), 'Nothing was created.' );
	}

	public function test_agent_draft_folds_the_answer_into_the_cast() {
		add_filter(
			'openstation_agent_draft',
			static function () {
				return array(
					'name'         => 'Draft Rider',
					'description'  => 'Rides drafts.',
					'vibes'        => 'swift',
					'instructions' => 'Do the rounds.',
					'role'         => 'no-such-role',
					'abilities'    => array( 'not-a-real-ability' ),
				);
			}
		);

		$response = $this->dispatch(
			'agent-draft',
			array(
				'casting' => true,
				'wstep'   => 0,
				'cast'    => $this->cast(
					array(
						'brief' => 'Go through my drafts once a week.',
						'name'  => '',
						'role'  => 'author',
					)
				),
			)
		);

		$this->assertSame( 1, $response['state']['wstep'], 'Filled in, Meet is a review.' );
		$cast = $response['state']['cast'];
		$this->assertSame( 'Draft Rider', $cast['name'] );
		$this->assertSame( 'swift', $cast['vibes'] );
		$this->assertSame( 'Do the rounds.', $cast['instructions'] );
		$this->assertSame( 'Do the rounds.', $cast['brief'], 'The rewrite lands in the brief, so Describe shows and edits the drafted prompt.' );
		$this->assertSame( 'author', $cast['role'], 'A role the site does not allow is dropped, keeping the cast\'s.' );
		$this->assertSame( array(), $cast['abilities'], 'Unknown abilities are filtered out.' );
		$this->assertFalse( $cast['drafting'], 'The in-flight flag is lowered in the returned state.' );
		$this->assertSame( '', $response['state']['briefError'] );
	}

	public function test_agent_draft_failure_lands_under_the_brief() {
		add_filter(
			'openstation_agent_draft',
			static function () {
				return new WP_Error( 'nope', 'The model is on holiday.' );
			}
		);

		$response = $this->dispatch(
			'agent-draft',
			array(
				'casting' => true,
				'cast'    => $this->cast( array( 'brief' => 'Anything.' ) ),
			)
		);

		$this->assertSame( 0, $response['state']['wstep'], 'The user stays on Describe.' );
		$this->assertSame( 'The model is on holiday.', $response['state']['briefError'] );
		$this->assertFalse( $response['state']['cast']['drafting'] );
	}

	public function test_back_cancels_the_wizard_before_leaving_the_section() {
		$response = $this->dispatch(
			'back',
			array(
				'casting' => true,
				'wstep'   => 3,
				'cast'    => $this->cast(),
			)
		);

		$this->assertFalse( $response['state']['casting'] );
		$this->assertNull( $response['state']['cast'] );
		$this->assertSame( 'agents', $response['state']['section'], 'Cancel stays in the section.' );
	}

	public function test_agent_update_patches_abilities_and_confirms() {
		$agent     = $this->make_agent( 'Toolsmith' );
		$catalogue = openstation_agents_abilities_catalogue();
		$slug      = (string) $catalogue[0]['slug'];

		$response = $this->dispatch(
			'agent-update',
			array( 'item' => (int) $agent->ID ),
			array(
				'id'        => (int) $agent->ID,
				'abilities' => array( $slug ),
			)
		);

		$this->assertSame( array( $slug ), openstation_agent_get_abilities( (int) $agent->ID ) );
		$this->assertSame( 'Abilities saved.', $response['state']['agentNotice'] );
	}

	public function test_agent_update_face_backfill_stays_silent() {
		$agent = $this->make_agent( 'Faceless' );

		$response = $this->dispatch(
			'agent-update',
			array(),
			array(
				'id'       => (int) $agent->ID,
				'face'     => array(
					'appearance' => array( 'hueStart' => 188 ),
					'physics'    => array(),
				),
				'faceSeed' => 21,
			)
		);

		$this->assertSame( '', $response['state']['agentNotice'], 'A courtesy write is not an announcement.' );
		$this->assertSame( 21, openstation_agent_get_face_seed( (int) $agent->ID ) );
	}

	public function test_agent_update_is_refused_without_the_manage_capability() {
		$agent = $this->make_agent( 'Immutable' );
		wp_set_current_user( self::$editor_id );

		$this->dispatch(
			'agent-update',
			array(),
			array(
				'id'   => (int) $agent->ID,
				'name' => 'Renamed',
			)
		);

		$this->assertSame( 'Immutable', get_userdata( (int) $agent->ID )->display_name );
	}

	public function test_agent_delete_removes_the_user_and_closes_the_pane() {
		$agent    = $this->make_agent( 'Ephemeral' );
		$response = $this->dispatch(
			'agent-delete',
			array( 'item' => (int) $agent->ID ),
			array( 'id' => (int) $agent->ID )
		);

		$this->assertFalse( get_userdata( (int) $agent->ID ), 'The agent user is gone.' );
		$this->assertSame( 0, $response['state']['item'], 'The pane closes rather than pointing at a ghost.' );
	}

	public function test_agent_delete_refuses_a_plain_user() {
		$victim   = self::factory()->user->create( array( 'role' => 'author' ) );
		$response = $this->dispatch(
			'agent-delete',
			array(),
			array( 'id' => $victim )
		);

		$this->assertInstanceOf( 'WP_User', get_userdata( $victim ), 'Only agents can be deleted here.' );
		$this->assertNotSame( '', $response['state']['agentNotice'] );
	}
}
