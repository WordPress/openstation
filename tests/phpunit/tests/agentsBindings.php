<?php
/**
 * Tests for the Agents bindings layer — triggers, model override,
 * rate limit user-meta and the trigger-kinds + hooks catalogues.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_Agents_Bindings extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_agent_trigger_kinds' );
		remove_all_filters( 'desktop_mode_agent_hooks_catalogue' );
		parent::tear_down();
	}

	private function make_agent_user() {
		$user_id = $this->factory()->user->create( array( 'role' => 'editor' ) );
		update_user_meta( $user_id, DESKTOP_MODE_AGENT_USER_MARKER_META, '1' );
		return $user_id;
	}

	/**
	 * @covers ::desktop_mode_agent_trigger_kinds
	 */
	public function test_built_in_trigger_kinds_present() {
		$kinds = desktop_mode_agent_trigger_kinds();
		$slugs = wp_list_pluck( $kinds, 'slug' );
		$this->assertContains( 'send-to', $slugs );
		$this->assertContains( 'drag', $slugs );
		$this->assertContains( 'chat', $slugs );
		$this->assertContains( 'hook', $slugs );
		$this->assertContains( 'endpoint', $slugs );
		$this->assertContains( 'agent', $slugs );
	}

	/**
	 * Every kind should now carry `label`, `description`, `icon`, and
	 * `config_schema` so the renderer's card grid has enough info to
	 * paint a tile without falling back to defaults.
	 *
	 * @covers ::desktop_mode_agent_trigger_kinds
	 */
	public function test_trigger_kinds_carry_renderable_metadata() {
		$kinds = desktop_mode_agent_trigger_kinds();
		foreach ( $kinds as $kind ) {
			$this->assertArrayHasKey( 'slug', $kind );
			$this->assertArrayHasKey( 'label', $kind );
			$this->assertArrayHasKey( 'description', $kind );
			$this->assertArrayHasKey( 'icon', $kind );
			$this->assertArrayHasKey( 'config_schema', $kind );
		}
	}

	/**
	 * The `send-to` kind validates an `entityKinds` array against the
	 * known enum (post / page / media / user / comment) — entries
	 * outside that set should not crash the sanitizer.
	 *
	 * @covers ::desktop_mode_agent_sanitize_triggers
	 */
	public function test_send_to_trigger_round_trips() {
		$uid = $this->make_agent_user();
		desktop_mode_agent_set_triggers(
			$uid,
			array(
				array(
					'kind'   => 'send-to',
					'config' => array(
						'entityKinds' => array( 'post', 'page' ),
					),
				),
			)
		);
		$triggers = desktop_mode_agent_get_triggers( $uid );
		$this->assertCount( 1, $triggers );
		$this->assertSame( 'send-to', $triggers[0]['kind'] );
		$this->assertSame( array( 'post', 'page' ), $triggers[0]['config']['entityKinds'] );
	}

	/**
	 * @covers ::desktop_mode_agents_collect_send_to_targets
	 */
	public function test_send_to_targets_harvest_projects_correct_shape() {
		$uid = $this->make_agent_user();
		wp_update_user( array( 'ID' => $uid, 'display_name' => 'Send-To Test' ) );
		desktop_mode_agent_set_triggers(
			$uid,
			array(
				array(
					'kind'   => 'send-to',
					'config' => array( 'entityKinds' => array( 'media', 'post' ) ),
				),
				array(
					'kind'   => 'chat',
					'config' => array( 'capability' => 'edit_posts' ),
				),
			)
		);

		$targets = desktop_mode_agents_collect_send_to_targets();
		$row     = null;
		foreach ( $targets as $candidate ) {
			if ( (int) $candidate['id'] === (int) $uid ) {
				$row = $candidate;
				break;
			}
		}
		$this->assertIsArray( $row, 'Agent with a send-to trigger should appear in the targets harvest.' );
		$this->assertSame( 'Send-To Test', $row['name'] );
		$this->assertContains( 'media', $row['entityKinds'] );
		$this->assertContains( 'post', $row['entityKinds'] );
		$this->assertNotContains( 'chat', $row['entityKinds'], 'Non-send-to triggers must not pollute entityKinds.' );

		// Cleanup.
		if ( ! function_exists( 'wp_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/user.php';
		}
		wp_delete_user( $uid );
	}

	/**
	 * @covers ::desktop_mode_agents_collect_send_to_targets
	 */
	public function test_send_to_targets_excludes_agents_without_send_to_trigger() {
		$uid = $this->make_agent_user();
		desktop_mode_agent_set_triggers(
			$uid,
			array(
				array(
					'kind'   => 'chat',
					'config' => array( 'capability' => 'edit_posts' ),
				),
			)
		);

		$ids = wp_list_pluck( desktop_mode_agents_collect_send_to_targets(), 'id' );
		$this->assertNotContains( $uid, $ids );

		if ( ! function_exists( 'wp_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/user.php';
		}
		wp_delete_user( $uid );
	}

	/**
	 * @covers ::desktop_mode_agent_trigger_kinds
	 */
	public function test_trigger_kinds_filter_can_extend() {
		add_filter(
			'desktop_mode_agent_trigger_kinds',
			static function ( $kinds ) {
				$kinds[] = array(
					'slug'          => 'webhook',
					'label'         => 'Webhook',
					'config_schema' => array(
						'type'       => 'object',
						'properties' => array( 'url' => array( 'type' => 'string' ) ),
					),
				);
				return $kinds;
			}
		);

		$slugs = wp_list_pluck( desktop_mode_agent_trigger_kinds(), 'slug' );
		$this->assertContains( 'webhook', $slugs );
	}

	/**
	 * @covers ::desktop_mode_agent_sanitize_triggers
	 */
	public function test_sanitize_drops_unknown_kinds() {
		$result = desktop_mode_agent_sanitize_triggers(
			array(
				array( 'kind' => 'drag',    'config' => array( 'mimeTypes' => array( 'image/*' ) ) ),
				array( 'kind' => 'unknown', 'config' => array() ),
				array( 'kind' => 'hook',    'config' => array( 'hook' => 'save_post', 'priority' => 10 ) ),
			)
		);
		$this->assertCount( 2, $result );
		$this->assertSame( 'drag', $result[0]['kind'] );
		$this->assertSame( 'hook', $result[1]['kind'] );
	}

	/**
	 * @covers ::desktop_mode_agent_sanitize_triggers
	 */
	public function test_sanitize_accepts_json_string() {
		$payload = wp_json_encode(
			array(
				array( 'kind' => 'chat', 'config' => array( 'capability' => 'edit_posts' ) ),
			)
		);
		$result = desktop_mode_agent_sanitize_triggers( $payload );
		$this->assertCount( 1, $result );
		$this->assertSame( 'edit_posts', $result[0]['config']['capability'] );
	}

	/**
	 * @covers ::desktop_mode_agent_set_triggers
	 * @covers ::desktop_mode_agent_get_triggers
	 */
	public function test_triggers_round_trip_through_user_meta() {
		$uid = $this->make_agent_user();
		desktop_mode_agent_set_triggers(
			$uid,
			array(
				array( 'kind' => 'hook', 'config' => array( 'hook' => 'wp_insert_comment', 'priority' => 20 ) ),
			)
		);
		$triggers = desktop_mode_agent_get_triggers( $uid );
		$this->assertCount( 1, $triggers );
		$this->assertSame( 'hook', $triggers[0]['kind'] );
		$this->assertSame( 'wp_insert_comment', $triggers[0]['config']['hook'] );
	}

	/**
	 * @covers ::desktop_mode_agent_set_triggers
	 */
	public function test_triggers_updated_action_fires() {
		$uid    = $this->make_agent_user();
		$caught = false;
		add_action(
			'desktop_mode_agent_triggers_updated',
			static function ( $user_id ) use ( &$caught, $uid ) {
				if ( $user_id === $uid ) {
					$caught = true;
				}
			}
		);
		desktop_mode_agent_set_triggers( $uid, array() );
		$this->assertTrue( $caught );
		remove_all_actions( 'desktop_mode_agent_triggers_updated' );
	}

	/**
	 * @covers ::desktop_mode_agent_set_model
	 * @covers ::desktop_mode_agent_get_model
	 */
	public function test_model_round_trip_and_clear() {
		$uid = $this->make_agent_user();
		desktop_mode_agent_set_model( $uid, 'claude-sonnet-4' );
		$this->assertSame( 'claude-sonnet-4', desktop_mode_agent_get_model( $uid ) );
		desktop_mode_agent_set_model( $uid, '' );
		$this->assertSame( '', desktop_mode_agent_get_model( $uid ) );
	}

	/**
	 * @covers ::desktop_mode_agent_set_rate_limit
	 * @covers ::desktop_mode_agent_get_rate_limit
	 */
	public function test_rate_limit_round_trip_and_clear() {
		$uid = $this->make_agent_user();
		desktop_mode_agent_set_rate_limit( $uid, 60 );
		$this->assertSame( 60, desktop_mode_agent_get_rate_limit( $uid ) );
		desktop_mode_agent_set_rate_limit( $uid, 0 );
		$this->assertSame( 0, desktop_mode_agent_get_rate_limit( $uid ) );
	}

	/**
	 * @covers ::desktop_mode_agent_hooks_catalogue
	 */
	public function test_hooks_catalogue_contains_save_post() {
		$hooks = desktop_mode_agent_hooks_catalogue();
		$names = wp_list_pluck( $hooks, 'hook' );
		$this->assertContains( 'save_post', $names );
		$this->assertContains( 'wp_insert_comment', $names );
	}
}
