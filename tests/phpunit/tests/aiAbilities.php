<?php
/**
 * Tests for the AI Copilot's WordPress Abilities (DESKMOD-9).
 *
 * Covers registration (category + abilities with populated schemas), the
 * permission gates that replaced the old capability checks, execute()
 * round-trips (including output-schema validation), the tool-name mapping the
 * agent loop relies on, and the soft model-preference filter.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_AiAbilities extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_ai_model' );
		remove_all_filters( 'desktop_mode_ai_abilities' );
		parent::tear_down();
	}

	/**
	 * A third-party ability can be offered to the Copilot via the
	 * `desktop_mode_ai_abilities` filter — the extension point that replaced
	 * `desktop_mode_register_ai_tool()`. Duplicates are collapsed.
	 *
	 * @covers ::desktop_mode_ai_search_ability_names
	 */
	public function test_ability_list_is_filterable() {
		add_filter( 'desktop_mode_ai_abilities', static function ( $names ) {
			$names[] = 'my-plugin/do-thing';
			$names[] = 'desktop-mode/search-posts'; // duplicate, should collapse.
			return $names;
		} );

		$names = desktop_mode_ai_search_ability_names();
		$this->assertContains( 'my-plugin/do-thing', $names );
		$this->assertSame( array_values( array_unique( $names ) ), $names, 'No duplicate ability names.' );
	}

	/**
	 * @covers ::desktop_mode_ai_register_ability_category
	 */
	public function test_category_is_registered() {
		$this->assertInstanceOf( 'WP_Ability_Category', wp_get_ability_category( 'desktop-mode' ) );
	}

	/**
	 * Every Copilot ability is registered under the desktop-mode category
	 * with a non-empty description and input + output schemas.
	 *
	 * @covers ::desktop_mode_ai_register_abilities
	 */
	public function test_all_abilities_registered_with_schemas() {
		$names = array_merge(
			desktop_mode_ai_search_ability_names(),
			array( 'desktop-mode/analyze-comment' )
		);

		foreach ( $names as $name ) {
			$ability = wp_get_ability( $name );
			$this->assertInstanceOf( 'WP_Ability', $ability, "Ability {$name} should be registered." );
			$this->assertSame( 'desktop-mode', $ability->get_category(), "Ability {$name} in desktop-mode category." );
			$this->assertNotEmpty( $ability->get_description(), "Ability {$name} has a description." );
			$this->assertNotEmpty( $ability->get_input_schema(), "Ability {$name} has an input schema." );
			$this->assertNotEmpty( $ability->get_output_schema(), "Ability {$name} has an output schema." );
		}
	}

	/**
	 * The search-turn ability list excludes the moderation-only analyze ability.
	 *
	 * @covers ::desktop_mode_ai_search_ability_names
	 */
	public function test_search_ability_list_excludes_comment_analysis() {
		$names = desktop_mode_ai_search_ability_names();
		$this->assertContains( 'desktop-mode/search-posts', $names );
		$this->assertNotContains( 'desktop-mode/analyze-comment', $names );
		$this->assertCount( 7, $names );
	}

	/**
	 * Tool names are the ability slug with the namespace stripped and dashes
	 * turned into underscores — reproducing the historical tool names.
	 *
	 * @covers ::desktop_mode_ai_ability_tool_name
	 */
	public function test_tool_name_derivation() {
		$this->assertSame( 'search_posts', desktop_mode_ai_ability_tool_name( 'desktop-mode/search-posts' ) );
		$this->assertSame( 'search_comments_by_post', desktop_mode_ai_ability_tool_name( 'desktop-mode/search-comments-by-post' ) );
		$this->assertSame( 'get_php_error_log', desktop_mode_ai_ability_tool_name( 'desktop-mode/get-php-error-log' ) );
	}

	/**
	 * A reader can execute the read-only search abilities; execute() passes
	 * output validation and returns the handler payload.
	 *
	 * @covers ::desktop_mode_ai_register_abilities
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
	 * @covers ::desktop_mode_ai_register_abilities
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
	 * @covers ::desktop_mode_ai_register_comment_analysis_ability
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
	 * @covers ::desktop_mode_ai_register_abilities
	 */
	public function test_mcp_exposure_is_limited_to_safe_abilities() {
		$public = wp_get_ability( 'desktop-mode/search-posts' )->get_meta();
		$this->assertArrayHasKey( 'mcp', $public );
		$this->assertTrue( $public['mcp']['public'] );

		$private = wp_get_ability( 'desktop-mode/get-php-error-log' )->get_meta();
		$this->assertArrayNotHasKey( 'mcp', $private );
	}

	/**
	 * The model-preference filter normalizes a string, an array, and the
	 * empty default.
	 *
	 * @covers ::desktop_mode_ai_model_preference
	 */
	public function test_model_preference_filter() {
		$this->assertSame( array(), desktop_mode_ai_model_preference( 1 ) );

		add_filter( 'desktop_mode_ai_model', static fn() => 'gpt-4o' );
		$this->assertSame( array( 'gpt-4o' ), desktop_mode_ai_model_preference( 1 ) );
		remove_all_filters( 'desktop_mode_ai_model' );

		add_filter( 'desktop_mode_ai_model', static fn() => array( 'claude-sonnet-4-5', '', 'gpt-4o' ) );
		$this->assertSame( array( 'claude-sonnet-4-5', 'gpt-4o' ), desktop_mode_ai_model_preference( 1 ) );
	}
}
