<?php
/**
 * Tests for the OpenStation journal RSS cache and normalization boundary.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-about-feed
 */

class OpenStation_About_Feed_Test_Author {
	private $name;

	public function __construct( $name ) {
		$this->name = $name;
	}

	public function get_name() {
		return $this->name;
	}
}

class OpenStation_About_Feed_Test_Item {
	private $title;
	private $url;
	private $author;
	private $description;
	private $date;

	public function __construct( $title, $url, $author, $description, $date ) {
		$this->title       = $title;
		$this->url         = $url;
		$this->author      = $author;
		$this->description = $description;
		$this->date        = $date;
	}

	public function get_title() {
		return $this->title;
	}

	public function get_permalink() {
		return $this->url;
	}

	public function get_author() {
		return new OpenStation_About_Feed_Test_Author( $this->author );
	}

	public function get_description() {
		return $this->description;
	}

	public function get_date() {
		return $this->date;
	}
}

class OpenStation_About_Feed_Test_Feed {
	private $items;

	public function __construct( $items ) {
		$this->items = $items;
	}

	public function get_items( $start, $limit ) {
		return array_slice( $this->items, $start, $limit );
	}

	public function get_title() {
		return 'OpenStation &amp; Friends';
	}

	public function get_description() {
		return '<p>A public <strong>dev diary</strong>.</p>';
	}

	public function get_link() {
		return 'https://openstation.blog/';
	}
}

/**
 * @group openstation
 * @group os-about-feed
 */
class Tests_OpenStation_AboutFeed extends WP_UnitTestCase {

	public function tear_down() {
		delete_transient( OPENSTATION_ABOUT_FEED_CACHE_KEY );
		delete_transient( OPENSTATION_ABOUT_FEED_STALE_KEY );
		delete_transient( OPENSTATION_ABOUT_FEED_FAILURE_KEY );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_normalize_about_feed
	 */
	public function test_normalizes_remote_markup_and_caps_the_feed() {
		$items = array();
		for ( $index = 1; $index <= 6; $index++ ) {
			$items[] = new OpenStation_About_Feed_Test_Item(
				"<em>Dispatch &amp; {$index}</em>",
				"https://openstation.blog/dispatch-{$index}/",
				'OpenStation &amp; Crew',
				'<p>' . str_repeat( 'journal ', 45 ) . '<script>alert(1)</script></p>',
				'2026-08-19T12:00:00+00:00'
			);
		}

		$payload = openstation_normalize_about_feed(
			new OpenStation_About_Feed_Test_Feed( $items )
		);

		$this->assertSame( 'OpenStation & Friends', $payload['title'] );
		$this->assertSame( 'A public dev diary.', $payload['description'] );
		$this->assertCount( 5, $payload['items'] );
		$this->assertSame( 'Dispatch & 1', $payload['items'][0]['title'] );
		$this->assertSame( 'OpenStation & Crew', $payload['items'][0]['author'] );
		$this->assertStringNotContainsString( '<', $payload['items'][0]['excerpt'] );
		$this->assertStringEndsWith( '…', $payload['items'][0]['excerpt'] );
		$this->assertFalse( $payload['stale'] );
	}

	/**
	 * @covers ::openstation_get_about_feed
	 */
	public function test_returns_the_fresh_application_cache_without_fetching() {
		$payload = array(
			'title' => 'Cached journal',
			'items' => array(),
			'stale' => false,
		);
		set_transient( OPENSTATION_ABOUT_FEED_CACHE_KEY, $payload, MINUTE_IN_SECONDS );

		$this->assertSame( $payload, openstation_get_about_feed() );
	}

	/**
	 * @covers ::openstation_get_about_feed
	 */
	public function test_returns_a_marked_stale_copy_during_failure_backoff() {
		$payload = array(
			'title' => 'Last known journal',
			'items' => array(),
			'stale' => false,
		);
		set_transient( OPENSTATION_ABOUT_FEED_STALE_KEY, $payload, WEEK_IN_SECONDS );
		set_transient( OPENSTATION_ABOUT_FEED_FAILURE_KEY, '1', MINUTE_IN_SECONDS );

		$result = openstation_get_about_feed();
		$this->assertSame( 'Last known journal', $result['title'] );
		$this->assertTrue( $result['stale'] );
	}
}
