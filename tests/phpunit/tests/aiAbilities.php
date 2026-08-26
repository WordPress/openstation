<?php
/**
 * Tests for the AI Copilot's WordPress Abilities.
 *
 * Covers registration (category + abilities with populated schemas), the
 * permission gates that replaced the old capability checks, execute()
 * round-trips (including output-schema validation), and the tool-name mapping
 * the agent loop relies on.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiAbilities extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}
	}

	/**
	 * The Copilot offers every registered read-only ability (its own plus any
	 * Core/third-party read-only ability), and nothing that isn't read-only.
	 *
	 * @covers ::openstation_ai_search_ability_names
	 */
	public function test_only_readonly_abilities_are_offered() {
		$names = openstation_ai_search_ability_names();

		$this->assertContains( 'desktop-mode/search-posts', $names );

		foreach ( $names as $name ) {
			$meta = (array) wp_get_ability( $name )->get_meta();
			$this->assertTrue(
				! empty( $meta['annotations']['readonly'] ),
				"Only read-only abilities should be offered; {$name} is not." )
			;
		}
	}

	/**
	 * @covers ::openstation_ai_register_ability_category
	 */
	public function test_category_is_registered() {
		$this->assertInstanceOf( 'WP_Ability_Category', wp_get_ability_category( 'openstation' ) );
	}

	/**
	 * Every Copilot ability is registered under the openstation category
	 * with a non-empty description and input + output schemas.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_all_abilities_registered_with_schemas() {
		$names = array_merge(
			openstation_ai_search_ability_names(),
			array( 'desktop-mode/analyze-comment' )
		);

		foreach ( $names as $name ) {
			$ability = wp_get_ability( $name );
			$this->assertInstanceOf( 'WP_Ability', $ability, "Ability {$name} should be registered." );
			$this->assertSame( 'openstation', $ability->get_category(), "Ability {$name} in openstation category." );
			$this->assertNotEmpty( $ability->get_description(), "Ability {$name} has a description." );
			$this->assertNotEmpty( $ability->get_input_schema(), "Ability {$name} has an input schema." );
			$this->assertNotEmpty( $ability->get_output_schema(), "Ability {$name} has an output schema." );
		}
	}

	/**
	 * Tool names are the ability slug with the namespace stripped and dashes
	 * turned into underscores — reproducing the historical tool names.
	 *
	 * @covers ::openstation_ai_ability_tool_name
	 */
	public function test_tool_name_derivation() {
		$this->assertSame( 'search_posts', openstation_ai_ability_tool_name( 'desktop-mode/search-posts' ) );
		$this->assertSame( 'search_comments_by_post', openstation_ai_ability_tool_name( 'desktop-mode/search-comments-by-post' ) );
		$this->assertSame( 'get_php_error_log', openstation_ai_ability_tool_name( 'desktop-mode/get-php-error-log' ) );

		// Third-party names are normalized to a provider-safe [a-z0-9_] shape.
		$this->assertSame( 'sub_do_thing', openstation_ai_ability_tool_name( 'My-Plugin/sub/Do.Thing' ) );
		$this->assertMatchesRegularExpression( '/^[a-z0-9_]+$/', openstation_ai_ability_tool_name( 'x/A B!C' ) );
	}

	/**
	 * A reader can execute the read-only search abilities; execute() passes
	 * output validation and returns the handler payload.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_search_posts_executes_for_reader() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = wp_get_ability( 'desktop-mode/search-posts' )->execute( array( 'query' => 'hello', 'offset' => 0 ) );

		$this->assertNotWPError( $result );
		$this->assertArrayHasKey( 'items', $result );
		$this->assertArrayHasKey( 'has_more', $result );
	}

	/**
	 * The error-log ability is gated on manage_options: a subscriber is
	 * cleanly refused (WP_Error, no fatal), an admin is allowed.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_error_log_ability_permission_gate() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$denied = wp_get_ability( 'desktop-mode/get-php-error-log' )->execute( array( 'lines' => 10 ) );
		$this->assertWPError( $denied );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$allowed = wp_get_ability( 'desktop-mode/get-php-error-log' )->execute( array( 'lines' => 10 ) );
		$this->assertNotWPError( $allowed );
		$this->assertArrayHasKey( 'log_available', $allowed );
	}

	/**
	 * The comment-analysis ability requires moderate_comments.
	 *
	 * @covers ::openstation_ai_register_comment_analysis_ability
	 */
	public function test_analyze_comment_ability_requires_moderation_cap() {
		$comment_id = self::factory()->comment->create();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$denied = wp_get_ability( 'desktop-mode/analyze-comment' )->execute( array( 'comment_id' => $comment_id ) );
		$this->assertWPError( $denied );
		$this->assertSame( 'ability_invalid_permissions', $denied->get_error_code() );
	}

	/**
	 * Only safe read-only abilities are exposed to external agents over MCP;
	 * the error log and comment analysis are not.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_mcp_exposure_is_limited_to_safe_abilities() {
		$public = wp_get_ability( 'desktop-mode/search-posts' )->get_meta();
		$this->assertArrayHasKey( 'mcp', $public );
		$this->assertTrue( $public['mcp']['public'] );

		$private = wp_get_ability( 'desktop-mode/get-php-error-log' )->get_meta();
		$this->assertArrayNotHasKey( 'mcp', $private );
	}
}
