<?php

class Tests_OpenStation_AgentsMyWordpress extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );

		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function disable_agents() {
		remove_all_filters( 'openstation_agents_enabled' );
		add_filter( 'openstation_agents_enabled', '__return_false' );
	}

	private function agents_config() {
		try {
			$response = openstation_apps_runtime()->dispatch(
				'my-wordpress',
				array(
					'action' => 'go',
					'state'  => array(),
					'args'   => array( 'section' => 'agents' ),
				),
				openstation_apps_os()
			);
		} catch ( Exception $e ) {
			return null;
		}
		if ( ! is_array( $response ) || ! isset( $response['data']['agents'] ) ) {
			return null;
		}
		return $response['data']['agents'];
	}

	private function entity_ids() {
		return wp_list_pluck(
			openstation_agents_my_wordpress_entity( array() ),
			'id'
		);
	}

	public function test_entity_is_appended_for_a_reader() {
		$entities = openstation_agents_my_wordpress_entity( array() );

		$this->assertCount( 1, $entities );
		$this->assertSame( 'agents', $entities[0]['id'] );
		$this->assertSame( 'agent', $entities[0]['kind'] );
		$this->assertSame( 'desktop-mode/v1/agents', $entities[0]['restPath'] );
		$this->assertNotEmpty( $entities[0]['icon'] );
	}

	public function test_entity_is_listed_while_the_framework_is_off() {
		$this->disable_agents();

		$this->assertSame( array( 'agents' ), $this->entity_ids() );
	}

	public function test_entity_is_withheld_from_users_who_cannot_read_agents() {
		wp_set_current_user( self::$subscriber_id );

		$this->assertSame( array(), $this->entity_ids() );
	}

	public function test_window_config_reports_enabled_when_the_flag_is_on() {
		$config = $this->agents_config();

		$this->assertTrue( $config['enabled'] );
		$this->assertTrue( $config['canEnable'] );
		$this->assertTrue( $config['canManage'] );
		$this->assertTrue( $config['canInvoke'] );
	}

	public function test_window_config_reports_disabled_when_the_flag_is_off() {
		$this->disable_agents();
		$config = $this->agents_config();

		$this->assertIsArray( $config );
		$this->assertFalse( $config['enabled'] );
	}

	public function test_the_roster_is_previewed_while_the_flag_is_off() {
		$this->disable_agents();
		$config = $this->agents_config();

		$this->assertArrayHasKey( 'preview', $config );
		$this->assertSameSize(
			openstation_agents_default_definitions(),
			$config['preview'],
			'The preview should carry the whole shipped cast.'
		);

		foreach ( $config['preview'] as $member ) {
			foreach ( array( 'name', 'vibes', 'description', 'role', 'roleLabel', 'face' ) as $key ) {
				$this->assertArrayHasKey( $key, $member );
			}
			$this->assertNotSame( '', $member['name'] );
			$this->assertArrayHasKey( 'appearance', $member['face'] );
			$this->assertArrayHasKey( 'physics', $member['face'] );
		}
	}

	public function test_the_preview_is_not_sent_once_the_framework_is_on() {
		$this->assertArrayNotHasKey( 'preview', $this->agents_config() );
	}

	public function test_the_preview_carries_only_what_a_card_draws() {
		foreach ( openstation_agents_preview_cast() as $member ) {
			$this->assertArrayNotHasKey( 'instructions', $member );
			$this->assertArrayNotHasKey( 'abilities', $member );
			$this->assertArrayNotHasKey( 'triggers', $member );
		}
	}

	public function test_a_previewed_face_is_the_face_the_seeder_stores() {
		$preview = openstation_agents_preview_cast();

		foreach ( openstation_agents_default_definitions() as $i => $definition ) {
			$stored = openstation_agent_sanitize_face_json( $definition['face'] );

			$this->assertNotSame( '', $stored, "{$definition['name']} stores no face." );
			$this->assertSame(
				$stored,
				wp_json_encode( $preview[ $i ]['face'] ),
				"The preview of {$definition['name']} is not the face it would be seeded with."
			);
		}
	}

	public function test_the_previewed_role_arrives_translated() {
		$names = wp_roles()->get_names();

		foreach ( openstation_agents_preview_cast() as $member ) {
			$this->assertArrayHasKey( $member['role'], $names );
			$this->assertSame(
				translate_user_role( $names[ $member['role'] ] ),
				$member['roleLabel']
			);
		}
	}

	public function test_can_enable_tracks_manage_options() {
		wp_set_current_user( self::$editor_id );
		$config = $this->agents_config();

		$this->assertIsArray( $config );
		$this->assertFalse( $config['canEnable'] );
		$this->assertFalse( $config['canManage'] );
		$this->assertTrue( $config['canInvoke'] );
	}

	public function test_window_config_is_withheld_from_users_who_cannot_read_agents() {
		wp_set_current_user( self::$subscriber_id );

		$this->assertNull( $this->agents_config() );
	}

	public function test_descriptor_helpers_are_declared_in_the_always_loaded_bootstrap() {
		$always_loaded = array(
			'openstation_agent_avatar_url',
			'openstation_agents_user_can_read',
			'openstation_agents_user_can_manage',
			'openstation_agents_user_can_invoke',
		);

		foreach ( $always_loaded as $function ) {
			$reflection = new ReflectionFunction( $function );
			$this->assertSame(
				'bootstrap.php',
				basename( $reflection->getFileName() ),
				"{$function}() must stay in the unconditionally loaded agents bootstrap."
			);
		}

		$this->assertStringContainsString(
			'agent-avatar.svg',
			openstation_agent_avatar_url()
		);
	}

	public function test_no_unguarded_agents_calls_from_outside_the_module() {
		$always_loaded = array( 'guard.php', 'bootstrap.php' );
		$root          = dirname( __DIR__, 3 ) . '/includes';
		$files         = new RegexIterator(
			new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $root ) ),
			'/\.php$/'
		);

		$unguarded = array();
		foreach ( $files as $file ) {
			$path = $file->getPathname();
			if ( false !== strpos( $path, '/includes/agents/' ) ) {
				continue;
			}
			$source = file_get_contents( $path );
			if ( ! preg_match_all( '/\b(openstation_agents?_[a-z0-9_]+)\s*\(/', $source, $matches ) ) {
				continue;
			}

			foreach ( array_unique( $matches[1] ) as $function ) {
				if ( ! function_exists( $function ) ) {
					continue;
				}
				$declared_in = basename( ( new ReflectionFunction( $function ) )->getFileName() );
				if ( in_array( $declared_in, $always_loaded, true ) ) {
					continue;
				}

				if ( false !== strpos( $source, "function_exists( '{$function}' )" ) ) {
					continue;
				}
				$unguarded[] = str_replace( $root, 'includes', $path ) . " → {$function}()";
			}
		}

		$this->assertSame(
			array(),
			$unguarded,
			"Agents functions reached from outside the module without a function_exists() guard.\n"
				. "These fatal on any site with the `agents` extended option off:\n  "
				. implode( "\n  ", $unguarded )
		);
	}
}
