<?php
/**
 * Tests for the AI Copilot's user-facing strings.
 *
 * The Copilot's progress ticks, continue-search label and permission
 * errors all render inside the assistant overlay, so they have to be
 * translatable and they have to read as sentences. Two failure modes
 * these cover:
 *
 *   - A string that skips `__()` renders in English whatever the site
 *     locale is, and never reaches the POT to be translated at all.
 *   - A noun interpolated from a tool slug. `search_posts` is already
 *     plural, so appending an "s" produced "Continue searching in
 *     postss", and no translation could have fixed it because the noun
 *     was never part of a translatable string.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiCopilotStrings extends WP_UnitTestCase {

	/**
	 * Every resumable tool gets a correctly pluralised continue label.
	 *
	 * @covers ::openstation_ai_continue_label
	 */
	public function test_continue_label_reads_as_a_sentence() {
		$expected = array(
			'search_posts'    => 'Continue searching in posts (from item 11)',
			'search_pages'    => 'Continue searching in pages (from item 11)',
			'search_comments' => 'Continue searching in comments (from item 11)',
		);

		foreach ( $expected as $tool => $label ) {
			$this->assertSame(
				$label,
				openstation_ai_continue_label( $tool, 11 ),
				"Continue label for {$tool} must name the entity in plain English."
			);
		}
	}

	/**
	 * The label never doubles the plural, whatever tool it is handed.
	 *
	 * @covers ::openstation_ai_continue_label
	 */
	public function test_continue_label_never_doubles_the_plural() {
		foreach ( openstation_ai_search_resumable_tools() as $tool ) {
			$this->assertStringNotContainsString(
				'ss (',
				openstation_ai_continue_label( $tool, 1 ),
				"Continue label for {$tool} must not double the trailing s."
			);
		}
	}

	/**
	 * Progress ticks are translatable.
	 *
	 * Swapping the locale through the `gettext` filter is enough: a
	 * string that reaches `__()` comes back marked, a hardcoded literal
	 * comes back untouched.
	 *
	 * @covers ::openstation_ai_progress_message
	 */
	public function test_progress_messages_go_through_gettext() {
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

		remove_filter( 'gettext', $mark, 10 );
	}
}
