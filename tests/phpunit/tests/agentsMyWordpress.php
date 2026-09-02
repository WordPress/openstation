<?php
/**
 * Tests for the agents ↔ WP Explorer integration, and for the wider
 * contract that a site with the `agents` extended option OFF still
 * boots.
 *
 * The integration loads regardless of the flag so the section is
 * always discoverable; what the flag decides is whether the section
 * arrives live or read-only. Both halves are pinned here, because a
 * regression on either one is invisible until someone opens the window
 * on a site that never turned agents on.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsMyWordpress extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );

		// On multisite a plain administrator lacks the super-admin-only
		// capabilities these tests exercise (update_core, edit_users,
		// activate_plugins and friends). The admin fixture means "the
		// fully-capable admin", which multisite spells super admin.
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

	/**
	 * Turn the framework off for the duration of one test. The suite
	 * bootstrap forces it on; the test framework restores hooks after
	 * every test, so this only affects the caller.
	 */
	private function disable_agents() {
		remove_all_filters( 'openstation_agents_enabled' );
		add_filter( 'openstation_agents_enabled', '__return_false' );
	}

	/**
	 * The agents section config, as the explorer APP ships it — the
	 * legacy window's config injection is gone; the same shape now
	 * rides the app's dispatch payload (`data.agents`), built over
	 * the same `openstation_agents_*` helpers.
	 */
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

	/**
	 * @covers ::openstation_agents_my_wordpress_entity
	 */
	public function test_entity_is_appended_for_a_reader() {
		$entities = openstation_agents_my_wordpress_entity( array() );

		$this->assertCount( 1, $entities );
		$this->assertSame( 'agents', $entities[0]['id'] );
		$this->assertSame( 'agent', $entities[0]['kind'] );
		$this->assertSame( 'desktop-mode/v1/agents', $entities[0]['restPath'] );
		$this->assertNotEmpty( $entities[0]['icon'] );
	}

	/**
	 * The whole point of the change: a site that has never enabled the
	 * framework still lists the section.
	 *
	 * @covers ::openstation_agents_my_wordpress_entity
	 */
	public function test_entity_is_listed_while_the_framework_is_off() {
		$this->disable_agents();

		$this->assertSame( array( 'agents' ), $this->entity_ids() );
	}

	/**
	 * @covers ::openstation_agents_my_wordpress_entity
	 */
	public function test_entity_is_withheld_from_users_who_cannot_read_agents() {
		wp_set_current_user( self::$subscriber_id );

		$this->assertSame( array(), $this->entity_ids() );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\agents_payload
	 */
	public function test_window_config_reports_enabled_when_the_flag_is_on() {
		$config = $this->agents_config();

		$this->assertTrue( $config['enabled'] );
		$this->assertTrue( $config['canEnable'] );
		$this->assertTrue( $config['canManage'] );
		$this->assertTrue( $config['canInvoke'] );
	}

	/**
	 * `enabled` is what tells the bundle not to fetch — the REST routes
	 * are genuinely absent while the flag is off, so a section that
	 * tried would 404 on every paint.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\agents_payload
	 */
	public function test_window_config_reports_disabled_when_the_flag_is_off() {
		$this->disable_agents();
		$config = $this->agents_config();

		$this->assertIsArray( $config );
		$this->assertFalse( $config['enabled'] );
	}

	/**
	 * The off-state's argument for turning the feature on: the crew the
	 * site would be seeded with, which does not exist as users yet.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\agents_payload
	 * @covers ::openstation_agents_preview_cast
	 */
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

	/**
	 * Once the flag is on the real cast has been seeded and the grid
	 * draws that instead, so the preview is dead weight on a payload
	 * that ships with every WP Explorer window.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\agents_payload
	 */
	public function test_the_preview_is_not_sent_once_the_framework_is_on() {
		$this->assertArrayNotHasKey( 'preview', $this->agents_config() );
	}

	/**
	 * The instructions and the abilities are the bulk of a definition
	 * and neither is on screen. Shipping them would put a few KB of
	 * system prompt on every window open, for nothing.
	 *
	 * @covers ::openstation_agents_preview_cast
	 */
	public function test_the_preview_carries_only_what_a_card_draws() {
		foreach ( openstation_agents_preview_cast() as $member ) {
			$this->assertArrayNotHasKey( 'instructions', $member );
			$this->assertArrayNotHasKey( 'abilities', $member );
			$this->assertArrayNotHasKey( 'triggers', $member );
		}
	}

	/**
	 * The preview is a promise about what you get, so it has to be the
	 * face the seeder would actually store. Both sides narrow through
	 * `openstation_mio_narrow_look()` for exactly this reason; this
	 * pins that they still agree.
	 *
	 * Compared as JSON rather than as arrays, because JSON is what both
	 * sides actually become — one into user meta, the other onto the
	 * window config — and the clamp hands back floats where the authored
	 * data had ints. `24.0` and `24` encode to the same byte and reach
	 * the same JavaScript number; asserting on the PHP types instead
	 * would fail on a difference that cannot be observed anywhere.
	 *
	 * @covers ::openstation_agents_preview_cast
	 */
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

	/**
	 * A real card reads its role label out of `/agents/roles`, and that
	 * route does not exist while the flag is off. Without the label on
	 * the payload every preview badge would read `editor`, in English,
	 * on every site.
	 *
	 * @covers ::openstation_agents_preview_cast
	 */
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

	/**
	 * An editor sees the section but cannot flip the option — the
	 * Extended options section of the Features tab is admin-only.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\agents_payload
	 */
	public function test_can_enable_tracks_manage_options() {
		wp_set_current_user( self::$editor_id );
		$config = $this->agents_config();

		$this->assertIsArray( $config );
		$this->assertFalse( $config['canEnable'] );
		$this->assertFalse( $config['canManage'] );
		$this->assertTrue( $config['canInvoke'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\agents_payload
	 */
	public function test_window_config_is_withheld_from_users_who_cannot_read_agents() {
		wp_set_current_user( self::$subscriber_id );

		$this->assertNull( $this->agents_config() );
	}

	/**
	 * The entity descriptor is built from helpers that used to live in
	 * rest.php / identity.php — neither of which is loaded while the
	 * flag is off, so moving one back there would fatal the WP Explorer
	 * window on exactly the sites this change exists for.
	 *
	 * The suite bootstrap forces the framework ON, so `function_exists`
	 * proves nothing here; the declaring file is the real assertion.
	 *
	 * @covers ::openstation_agent_avatar_url
	 * @covers ::openstation_agents_user_can_read
	 * @covers ::openstation_agents_user_can_manage
	 * @covers ::openstation_agents_user_can_invoke
	 */
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

	/**
	 * Every agents function called from OUTSIDE `includes/agents/` must
	 * either be declared in a file that loads unconditionally, or be
	 * wrapped in `function_exists()` at the call site.
	 *
	 * This is the one class of agents bug the rest of the suite cannot
	 * see: the bootstrap forces the framework ON, so a call into
	 * store.php resolves fine here and fatals only on a real install
	 * with the option off. It shipped once exactly that way —
	 * `OpenStation_User_File::serialize()` guarded on
	 * `openstation_agent_is_agent()` (guard.php, always loaded) and
	 * then called `openstation_agent_get_description()` (store.php,
	 * not loaded), so turning agents off with an agent tile on the
	 * desktop fataled the whole admin.
	 *
	 * @coversNothing
	 */
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
				// `function_exists( 'name' )` anywhere in the file is
				// accepted — the call sites are short enough that a
				// per-file guard is the honest granularity here.
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
