<?php
/**
 * Tests for the AI Copilot's user-facing strings.
 *
 * The Copilot's progress ticks and continue-search label render inside
 * the assistant overlay, so they have to be translatable, and every
 * resumable tool has to get a label that names its own entity.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiCopilotStrings extends WP_UnitTestCase {

	/**
	 * Every resumable tool gets a label of its own.
	 *
	 * `openstation_ai_continue_label()` falls back to the post wording for
	 * an unrecognised tool, so a tool added to the resumable list without a
	 * matching case would silently tell the user it is searching posts.
	 * Distinct labels are what catch that: the new tool would collide with
	 * `search_posts`.
	 *
	 * @covers ::openstation_ai_continue_label
	 */
	public function test_every_resumable_tool_gets_its_own_label() {
		$labels = array();
		foreach ( openstation_ai_search_resumable_tools() as $tool ) {
			$labels[ $tool ] = openstation_ai_continue_label( $tool, 11 );
		}

		$this->assertSame(
			count( $labels ),
			count( array_unique( $labels ) ),
			'Each resumable tool needs its own case in openstation_ai_continue_label(); '
				. 'a duplicate means one fell through to the default post wording.'
		);
	}

	/**
	 * The continue label names the entity, and names it once.
	 *
	 * @covers ::openstation_ai_continue_label
	 */
	public function test_continue_label_reads_as_a_sentence() {
		$this->assertSame(
			'Continue searching in posts (from item 11)',
			openstation_ai_continue_label( 'search_posts', 11 )
		);
		$this->assertSame(
			'Continue searching in comments (from item 4)',
			openstation_ai_continue_label( 'search_comments', 4 )
		);
	}

	/**
	 * Progress ticks and continue labels are translatable.
	 *
	 * Marking through the `gettext` filter is enough to tell them apart: a
	 * string that reaches `__()` comes back marked, a bare literal does not.
	 *
	 * @covers ::openstation_ai_progress_message
	 * @covers ::openstation_ai_continue_label
	 */
	public function test_strings_go_through_gettext() {
		$mark = static function ( $translated ) {
			return '[xx]' . $translated;
		};
		add_filter( 'gettext', $mark, 10, 1 );

		$tools = array(
			'search_posts',
			'search_pages',
			'search_comments',
			'search_comments_by_post',
			'list_admin_pages',
			'search_wporg_plugins',
			'get_php_error_log',
			'an_unknown_tool',
		);

		foreach ( $tools as $tool ) {
			$this->assertStringStartsWith(
				'[xx]',
				openstation_ai_progress_message( $tool ),
				"Progress message for {$tool} must go through __()."
			);
		}

		foreach ( openstation_ai_search_resumable_tools() as $tool ) {
			$this->assertStringStartsWith(
				'[xx]',
				openstation_ai_continue_label( $tool, 1 ),
				"Continue label for {$tool} must go through __()."
			);
		}

		remove_filter( 'gettext', $mark, 10 );
	}
}
