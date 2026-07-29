<?php
/**
 * Feed fetching, normalization, persistence, and unread-state service.
 *
 * @package DesktopModeFeedBuddy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Owns FeedBuddy's server-side state.
 */
class Feed_Buddy_Service {

	const META_SUBSCRIPTIONS = '_feed_buddy_subscriptions';
	const META_READ_ITEMS    = '_feed_buddy_read_items';
	const META_PREFERENCES   = '_feed_buddy_preferences';
	const META_LAST_REFRESH  = '_feed_buddy_last_refresh';

	const CACHE_TTL         = 600;
	const REFRESH_COOLDOWN  = 30;
	const MAX_SUBSCRIPTIONS = 200;
	const MAX_ITEMS         = 50;
	const MAX_READ_IDS      = 250;
	const MAX_RESPONSE_SIZE = 1048576;

	/**
	 * Return the complete user-facing state projection.
	 *
	 * @param int $user_id WordPress user ID.
	 * @return array
	 */
	public function get_state( $user_id ) {
		$subscriptions = $this->get_subscriptions( $user_id );
		$read_state    = $this->get_read_state( $user_id );
		$summaries     = array();

		foreach ( $subscriptions as $subscription ) {
			$feed = $this->get_feed_for_subscription( $subscription );
			if ( is_wp_error( $feed ) ) {
				$summaries[] = array(
					'id'            => $subscription['id'],
					'status'        => 'error',
					'unread'        => 0,
					'lastFetchedAt' => null,
					'error'         => $this->public_error_message( $feed ),
				);
				continue;
			}

			$read_ids = isset( $read_state[ $subscription['id'] ] )
				? array_flip( (array) $read_state[ $subscription['id'] ] )
				: array();
			$unread   = 0;
			foreach ( $feed['items'] as $item ) {
				if ( ! isset( $read_ids[ $item['id'] ] ) ) {
					++$unread;
				}
			}

			$summaries[] = array(
				'id'            => $subscription['id'],
				'status'        => 'online',
				'unread'        => $unread,
				'lastFetchedAt' => $feed['lastFetchedAt'],
				'error'         => null,
			);
		}

		return array(
			'subscriptions' => $subscriptions,
			'summaries'     => $summaries,
			'groups'        => $this->groups_from_subscriptions( $subscriptions ),
			'preferences'   => $this->get_preferences( $user_id ),
		);
	}

	/**
	 * Add and baseline a subscription.
	 *
	 * @param int   $user_id WordPress user ID.
	 * @param array $input    REST input.
	 * @return array|WP_Error
	 */
	public function add_subscription( $user_id, array $input ) {
		$url = isset( $input['url'] ) ? esc_url_raw( trim( (string) $input['url'] ) ) : '';
		if ( ! $this->is_safe_url( $url ) ) {
			return new WP_Error(
				'feed_buddy_invalid_url',
				__( 'Enter a public HTTP or HTTPS feed or website URL.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 400 )
			);
		}

		$subscriptions = $this->get_subscriptions( $user_id );
		if ( count( $subscriptions ) >= self::MAX_SUBSCRIPTIONS ) {
			return new WP_Error(
				'feed_buddy_subscription_limit',
				__( 'SOL Inbound Monologue supports up to 200 subscriptions per user. You were warned.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 400 )
			);
		}

		$feed = $this->resolve_feed( $url, false );
		if ( is_wp_error( $feed ) ) {
			return $feed;
		}

		foreach ( $subscriptions as $existing ) {
			if ( untrailingslashit( $existing['url'] ) === untrailingslashit( $feed['url'] ) ) {
				return new WP_Error(
					'feed_buddy_duplicate_subscription',
					__( 'You already follow this feed.', 'desktop-mode-feed-buddy' ),
					array( 'status' => 409 )
				);
			}
		}

		$title = isset( $input['title'] ) ? sanitize_text_field( (string) $input['title'] ) : '';
		$group = isset( $input['group'] ) ? sanitize_text_field( (string) $input['group'] ) : '';
		$id    = wp_generate_uuid4();

		$subscription    = array(
			'id'      => $id,
			'url'     => $feed['url'],
			'title'   => '' !== $title ? $title : $feed['title'],
			'group'   => '' !== $group ? $group : __( 'Feeds', 'desktop-mode-feed-buddy' ),
			'order'   => count( $subscriptions ),
			'addedAt' => gmdate( 'c' ),
		);
		$subscriptions[] = $subscription;
		$this->save_subscriptions( $user_id, $subscriptions );

		$read_state        = $this->get_read_state( $user_id );
		$read_state[ $id ] = array_map(
			static function ( $item ) {
				return $item['id'];
			},
			$feed['items']
		);
		$this->save_read_state( $user_id, $read_state );

		return $this->get_state( $user_id );
	}

	/**
	 * Update title, group, or order.
	 *
	 * @param int    $user_id        WordPress user ID.
	 * @param string $subscription_id Subscription UUID.
	 * @param array  $input          REST input.
	 * @return array|WP_Error
	 */
	public function update_subscription( $user_id, $subscription_id, array $input ) {
		$subscriptions = $this->get_subscriptions( $user_id );
		$index         = $this->find_subscription_index( $subscriptions, $subscription_id );
		if ( null === $index ) {
			return $this->not_found_error();
		}

		if ( array_key_exists( 'title', $input ) ) {
			$title = sanitize_text_field( (string) $input['title'] );
			if ( '' === $title ) {
				return new WP_Error(
					'feed_buddy_missing_title',
					__( 'Feed title cannot be empty.', 'desktop-mode-feed-buddy' ),
					array( 'status' => 400 )
				);
			}
			$subscriptions[ $index ]['title'] = $title;
		}

		if ( array_key_exists( 'group', $input ) ) {
			$group                            = sanitize_text_field( (string) $input['group'] );
			$subscriptions[ $index ]['group'] = '' !== $group
				? $group
				: __( 'Feeds', 'desktop-mode-feed-buddy' );
		}

		if ( isset( $input['direction'] ) ) {
			$direction = (int) $input['direction'];
			$target    = $index + ( $direction < 0 ? -1 : 1 );
			if ( $target >= 0 && $target < count( $subscriptions ) ) {
				$temp                     = $subscriptions[ $target ];
				$subscriptions[ $target ] = $subscriptions[ $index ];
				$subscriptions[ $index ]  = $temp;
			}
		}

		$this->save_subscriptions( $user_id, $subscriptions );
		return $this->get_state( $user_id );
	}

	/**
	 * Remove a subscription and its read/refresh state.
	 *
	 * @param int    $user_id        WordPress user ID.
	 * @param string $subscription_id Subscription UUID.
	 * @return array|WP_Error
	 */
	public function delete_subscription( $user_id, $subscription_id ) {
		$subscriptions = $this->get_subscriptions( $user_id );
		$index         = $this->find_subscription_index( $subscriptions, $subscription_id );
		if ( null === $index ) {
			return $this->not_found_error();
		}

		array_splice( $subscriptions, $index, 1 );
		$this->save_subscriptions( $user_id, $subscriptions );

		$read_state = $this->get_read_state( $user_id );
		unset( $read_state[ $subscription_id ] );
		$this->save_read_state( $user_id, $read_state );

		$refresh_state = get_user_meta( $user_id, self::META_LAST_REFRESH, true );
		$refresh_state = is_array( $refresh_state ) ? $refresh_state : array();
		unset( $refresh_state[ $subscription_id ] );
		update_user_meta( $user_id, self::META_LAST_REFRESH, $refresh_state );

		return $this->get_state( $user_id );
	}

	/**
	 * Return a cursor-paginated item projection.
	 *
	 * @param int         $user_id WordPress user ID.
	 * @param string|null $feed_id Optional subscription ID.
	 * @param int         $cursor  Numeric offset.
	 * @param bool        $unread_only Whether to filter read entries.
	 * @return array|WP_Error
	 */
	public function get_items( $user_id, $feed_id = null, $cursor = 0, $unread_only = false ) {
		$subscriptions = $this->get_subscriptions( $user_id );
		$read_state    = $this->get_read_state( $user_id );
		$items         = array();

		if ( $feed_id ) {
			$index = $this->find_subscription_index( $subscriptions, $feed_id );
			if ( null === $index ) {
				return $this->not_found_error();
			}
			$subscriptions = array( $subscriptions[ $index ] );
		}

		foreach ( $subscriptions as $subscription ) {
			$feed = $this->get_feed_for_subscription( $subscription );
			if ( is_wp_error( $feed ) ) {
				continue;
			}
			$read_ids = isset( $read_state[ $subscription['id'] ] )
				? array_flip( (array) $read_state[ $subscription['id'] ] )
				: array();

			foreach ( $feed['items'] as $item ) {
				$item['feedId']    = $subscription['id'];
				$item['feedTitle'] = $subscription['title'];
				$item['unread']    = ! isset( $read_ids[ $item['id'] ] );
				if ( $unread_only && ! $item['unread'] ) {
					continue;
				}
				$items[] = $item;
			}
		}

		usort(
			$items,
			static function ( $left, $right ) {
				return strcmp( (string) $right['publishedAt'], (string) $left['publishedAt'] );
			}
		);

		$cursor = max( 0, (int) $cursor );
		$page   = array_slice( $items, $cursor, 20 );
		$next   = $cursor + count( $page );

		return array(
			'items'      => array_values( $page ),
			'nextCursor' => $next < count( $items ) ? (string) $next : null,
		);
	}

	/**
	 * Mark item, feed, or all-feed records read/unread.
	 *
	 * @param int   $user_id WordPress user ID.
	 * @param array $input   REST input.
	 * @return array|WP_Error
	 */
	public function update_read_state( $user_id, array $input ) {
		$scope   = isset( $input['scope'] ) ? sanitize_key( (string) $input['scope'] ) : 'item';
		$read    = ! isset( $input['read'] ) || rest_sanitize_boolean( $input['read'] );
		$feed_id = isset( $input['feedId'] ) ? sanitize_text_field( (string) $input['feedId'] ) : '';
		$ids     = isset( $input['itemIds'] ) && is_array( $input['itemIds'] )
			? array_map( 'sanitize_text_field', $input['itemIds'] )
			: array();

		$subscriptions = $this->get_subscriptions( $user_id );
		$read_state    = $this->get_read_state( $user_id );
		$targets       = array();

		if ( 'all' === $scope ) {
			$targets = $subscriptions;
		} elseif ( 'feed' === $scope ) {
			$index = $this->find_subscription_index( $subscriptions, $feed_id );
			if ( null === $index ) {
				return $this->not_found_error();
			}
			$targets = array( $subscriptions[ $index ] );
		} else {
			if ( '' === $feed_id || empty( $ids ) ) {
				return new WP_Error(
					'feed_buddy_missing_items',
					__( 'Choose at least one feed item.', 'desktop-mode-feed-buddy' ),
					array( 'status' => 400 )
				);
			}
			$index = $this->find_subscription_index( $subscriptions, $feed_id );
			if ( null === $index ) {
				return $this->not_found_error();
			}
			$targets = array( $subscriptions[ $index ] );
		}

		foreach ( $targets as $subscription ) {
			$target_ids = $ids;
			if ( 'item' !== $scope ) {
				$feed = $this->get_feed_for_subscription( $subscription );
				if ( is_wp_error( $feed ) ) {
					continue;
				}
				$target_ids = array_map(
					static function ( $item ) {
						return $item['id'];
					},
					$feed['items']
				);
			}

			$current = isset( $read_state[ $subscription['id'] ] )
				? array_values( array_unique( (array) $read_state[ $subscription['id'] ] ) )
				: array();
			if ( $read ) {
				$current = array_values( array_unique( array_merge( $current, $target_ids ) ) );
				$current = array_slice( $current, -self::MAX_READ_IDS );
			} else {
				$current = array_values( array_diff( $current, $target_ids ) );
			}
			$read_state[ $subscription['id'] ] = $current;
		}

		$this->save_read_state( $user_id, $read_state );
		return $this->get_state( $user_id );
	}

	/**
	 * Force-refresh one or all subscriptions, respecting per-user cooldowns.
	 *
	 * @param int         $user_id WordPress user ID.
	 * @param string|null $feed_id Optional subscription ID.
	 * @return array|WP_Error
	 */
	public function refresh( $user_id, $feed_id = null ) {
		$subscriptions = $this->get_subscriptions( $user_id );
		if ( $feed_id ) {
			$index = $this->find_subscription_index( $subscriptions, $feed_id );
			if ( null === $index ) {
				return $this->not_found_error();
			}
			$subscriptions = array( $subscriptions[ $index ] );
		}

		$refresh_state = get_user_meta( $user_id, self::META_LAST_REFRESH, true );
		$refresh_state = is_array( $refresh_state ) ? $refresh_state : array();
		$now           = time();

		foreach ( $subscriptions as $subscription ) {
			$last = isset( $refresh_state[ $subscription['id'] ] )
				? (int) $refresh_state[ $subscription['id'] ]
				: 0;
			if ( $now - $last < self::REFRESH_COOLDOWN ) {
				if ( $feed_id ) {
					return new WP_Error(
						'feed_buddy_refresh_rate_limited',
						__( 'That feed was refreshed moments ago. Try again shortly.', 'desktop-mode-feed-buddy' ),
						array(
							'status'     => 429,
							'retryAfter' => self::REFRESH_COOLDOWN - ( $now - $last ),
						)
					);
				}
				continue;
			}

			$refresh_state[ $subscription['id'] ] = $now;
			$this->resolve_feed( $subscription['url'], true );
		}

		update_user_meta( $user_id, self::META_LAST_REFRESH, $refresh_state );
		return $this->get_state( $user_id );
	}

	/**
	 * Persist supported preferences.
	 *
	 * @param int   $user_id WordPress user ID.
	 * @param array $input   REST input.
	 * @return array
	 */
	public function update_preferences( $user_id, array $input ) {
		$preferences = $this->get_preferences( $user_id );
		if ( isset( $input['preferences'] ) && is_array( $input['preferences'] )
			&& array_key_exists( 'soundEnabled', $input['preferences'] ) ) {
			$preferences['soundEnabled'] = rest_sanitize_boolean( $input['preferences']['soundEnabled'] );
		}
		update_user_meta( $user_id, self::META_PREFERENCES, $preferences );
		return $this->get_state( $user_id );
	}

	/**
	 * Read ordered subscriptions.
	 *
	 * @param int $user_id WordPress user ID.
	 * @return array
	 */
	public function get_subscriptions( $user_id ) {
		$value = get_user_meta( $user_id, self::META_SUBSCRIPTIONS, true );
		$value = is_array( $value ) ? $value : array();
		usort(
			$value,
			static function ( $left, $right ) {
				return (int) $left['order'] <=> (int) $right['order'];
			}
		);
		return array_values( $value );
	}

	/**
	 * Resolve and normalize a public RSS/Atom feed or discover one from HTML.
	 *
	 * @param string $url   Feed or homepage URL.
	 * @param bool   $force Whether to bypass transients.
	 * @return array|WP_Error
	 */
	public function resolve_feed( $url, $force = false ) {
		$cache_key = $this->cache_key( $url );
		if ( ! $force ) {
			$cached = get_transient( $cache_key );
			if ( is_array( $cached ) && isset( $cached['items'], $cached['url'] ) ) {
				return $cached;
			}
		}

		$response = $this->safe_request( $url );
		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$feed = $this->parse_feed( $response['body'], $url );
		if ( ! is_wp_error( $feed ) ) {
			set_transient( $cache_key, $feed, self::CACHE_TTL );
			return $feed;
		}

		$candidates = $this->discover_feed_urls( $response['body'], $url );
		foreach ( array_slice( $candidates, 0, 5 ) as $candidate ) {
			$candidate_response = $this->safe_request( $candidate );
			if ( is_wp_error( $candidate_response ) ) {
				continue;
			}
			$feed = $this->parse_feed( $candidate_response['body'], $candidate );
			if ( ! is_wp_error( $feed ) ) {
				set_transient( $this->cache_key( $candidate ), $feed, self::CACHE_TTL );
				set_transient( $cache_key, $feed, self::CACHE_TTL );
				return $feed;
			}
		}

		return new WP_Error(
			'feed_buddy_not_a_feed',
			__( 'SOL Inbound Monologue could not find a readable RSS or Atom feed at that address.', 'desktop-mode-feed-buddy' ),
			array( 'status' => 422 )
		);
	}

	/**
	 * Parse already-fetched bytes with SimplePie network fetching disabled.
	 *
	 * @param string $body Feed bytes.
	 * @param string $url  Canonical feed URL.
	 * @return array|WP_Error
	 */
	private function parse_feed( $body, $url ) {
		require_once ABSPATH . WPINC . '/feed.php';
		require_once ABSPATH . WPINC . '/class-simplepie.php';

		$simplepie_class = class_exists( 'SimplePie\SimplePie' )
			? 'SimplePie\SimplePie'
			: 'SimplePie';
		$feed            = new $simplepie_class();
		$feed->enable_cache( false );
		$feed->set_raw_data( $body );
		$feed->set_stupidly_fast( true );
		$previous_error_reporting = error_reporting(); // phpcs:ignore -- Preserve the exact site setting during bounded third-party parsing.
		error_reporting( $previous_error_reporting & ~E_USER_NOTICE ); // phpcs:ignore -- Invalid remote feeds must not write parser notices to the site log.
		try {
			$initialized = $feed->init();
		} finally {
			error_reporting( $previous_error_reporting ); // phpcs:ignore -- Restore the exact site setting after bounded parsing.
		}
		if ( ! $initialized ) {
			return new WP_Error( 'feed_buddy_parse_failed', 'Invalid feed.' );
		}

		$title = sanitize_text_field( (string) $feed->get_title() );
		$items = $feed->get_items( 0, self::MAX_ITEMS );
		if ( '' === $title && empty( $items ) ) {
			return new WP_Error( 'feed_buddy_parse_failed', 'Invalid feed.' );
		}

		if ( '' === $title ) {
			$host  = wp_parse_url( $url, PHP_URL_HOST );
			$title = $host ? (string) $host : __( 'Untitled feed', 'desktop-mode-feed-buddy' );
		}

		$normalized = array();
		foreach ( (array) $items as $item ) {
			$link_raw = trim( (string) $item->get_link() );
			$scheme   = wp_parse_url( $link_raw, PHP_URL_SCHEME );
			$link     = $url;
			if ( '' !== $link_raw
				&& ( ! $scheme || in_array( strtolower( (string) $scheme ), array( 'http', 'https' ), true ) )
			) {
				$link = $this->resolve_relative_url( $link_raw, $url );
			}
			if ( ! $this->is_safe_url( $link ) ) {
				$link = $url;
			}
			$guid     = (string) $item->get_id();
			$date_raw = (string) $item->get_date( 'U' );
			$date     = ctype_digit( $date_raw ) ? (int) $date_raw : 0;
			$identity = '' !== $guid ? $guid : $link_raw;
			if ( '' === $identity ) {
				$identity = (string) $item->get_title() . '|' . $date_raw;
			}

			$description = (string) $item->get_description();
			if ( '' === $description ) {
				$description = (string) $item->get_content();
			}
			$excerpt = html_entity_decode(
				wp_strip_all_tags( $description, true ),
				ENT_QUOTES | ENT_HTML5,
				get_bloginfo( 'charset' )
			);
			$excerpt = preg_replace( '/\s+/u', ' ', trim( $excerpt ) );
			$excerpt = wp_html_excerpt( (string) $excerpt, 320, '…' );

			$author      = $item->get_author();
			$author_name = $author ? sanitize_text_field( (string) $author->get_name() ) : '';
			$item_title  = sanitize_text_field( (string) $item->get_title() );
			if ( '' === $item_title ) {
				$item_title = __( 'Untitled update', 'desktop-mode-feed-buddy' );
			}

			$normalized[] = array(
				'id'          => hash( 'sha256', $url . '|' . $identity ),
				'title'       => $item_title,
				'url'         => $link,
				'author'      => $author_name,
				'publishedAt' => $date > 0 ? gmdate( 'c', $date ) : null,
				'excerpt'     => $excerpt,
			);
		}

		return array(
			'url'           => esc_url_raw( $url ),
			'title'         => $title,
			'description'   => sanitize_text_field( wp_strip_all_tags( (string) $feed->get_description() ) ),
			'items'         => $normalized,
			'lastFetchedAt' => gmdate( 'c' ),
		);
	}

	/**
	 * Fetch a public URL with SSRF and response-size protections.
	 *
	 * @param string $url URL.
	 * @return array|WP_Error
	 */
	private function safe_request( $url ) {
		if ( ! $this->is_safe_url( $url ) ) {
			return new WP_Error(
				'feed_buddy_unsafe_url',
				__( 'That address is not available to the feed reader.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 400 )
			);
		}

		$response = wp_safe_remote_get(
			$url,
			array(
				'timeout'             => 8,
				'redirection'         => 3,
				'limit_response_size' => self::MAX_RESPONSE_SIZE,
				'user-agent'          => 'SOL-IM/' . FEED_BUDDY_VERSION . '; ' . home_url( '/' ),
				'headers'             => array(
					'Accept' => 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'feed_buddy_http_failed',
				__( 'SOL Inbound Monologue could not reach that address.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 502 )
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = (string) wp_remote_retrieve_body( $response );
		if ( $code < 200 || $code >= 300 || '' === $body ) {
			return new WP_Error(
				'feed_buddy_http_status',
				__( 'That address did not return a readable feed.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 502 )
			);
		}
		if ( strlen( $body ) > self::MAX_RESPONSE_SIZE ) {
			return new WP_Error(
				'feed_buddy_response_too_large',
				__( 'That feed is too large to read safely.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 413 )
			);
		}

		return array( 'body' => $body );
	}

	/**
	 * Discover RSS/Atom alternate links without executing document content.
	 *
	 * @param string $html     HTML response.
	 * @param string $base_url Source page URL.
	 * @return array
	 */
	private function discover_feed_urls( $html, $base_url ) {
		if ( ! class_exists( 'DOMDocument' ) ) {
			return array();
		}

		$previous = libxml_use_internal_errors( true );
		$document = new DOMDocument();
		$loaded   = $document->loadHTML( '<?xml encoding="utf-8" ?>' . $html, LIBXML_NONET );
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );
		if ( ! $loaded ) {
			return array();
		}

		$urls = array();
		foreach ( $document->getElementsByTagName( 'link' ) as $link ) {
			$rel  = strtolower( (string) $link->getAttribute( 'rel' ) );
			$type = strtolower( (string) $link->getAttribute( 'type' ) );
			$href = trim( (string) $link->getAttribute( 'href' ) );
			if ( false === strpos( $rel, 'alternate' ) || ''
				=== $href || ! in_array(
					$type,
					array( 'application/rss+xml', 'application/atom+xml', 'application/rdf+xml', 'text/xml' ),
					true
				) ) {
				continue;
			}
			$resolved = $this->resolve_relative_url( $href, $base_url );
			if ( $resolved && $this->is_safe_url( $resolved ) ) {
				$urls[] = $resolved;
			}
		}
		return array_values( array_unique( $urls ) );
	}

	/**
	 * Resolve common absolute, protocol-relative, root-relative, and path-relative URLs.
	 *
	 * @param string $href     Candidate URL.
	 * @param string $base_url Page URL.
	 * @return string
	 */
	private function resolve_relative_url( $href, $base_url ) {
		$href = trim( html_entity_decode( $href, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		if ( preg_match( '#^https?://#i', $href ) ) {
			return esc_url_raw( $href );
		}

		$base = wp_parse_url( $base_url );
		if ( ! is_array( $base ) || empty( $base['scheme'] ) || empty( $base['host'] ) ) {
			return '';
		}
		$origin = $base['scheme'] . '://' . $base['host'];
		if ( ! empty( $base['port'] ) ) {
			$origin .= ':' . (int) $base['port'];
		}
		if ( 0 === strpos( $href, '//' ) ) {
			return esc_url_raw( $base['scheme'] . ':' . $href );
		}
		if ( 0 === strpos( $href, '/' ) ) {
			return esc_url_raw( $origin . $href );
		}

		$path = isset( $base['path'] ) ? (string) $base['path'] : '/';
		$path = trailingslashit( dirname( $path ) );
		return esc_url_raw( $origin . $path . $href );
	}

	/**
	 * Validate scheme and WordPress' public-URL rules.
	 *
	 * @param string $url URL.
	 * @return bool
	 */
	private function is_safe_url( $url ) {
		$scheme = wp_parse_url( $url, PHP_URL_SCHEME );
		return in_array( strtolower( (string) $scheme ), array( 'http', 'https' ), true )
			&& false !== wp_http_validate_url( $url );
	}

	/**
	 * Read a subscription feed through the normalized cache.
	 *
	 * @param array $subscription Subscription record.
	 * @return array|WP_Error
	 */
	private function get_feed_for_subscription( array $subscription ) {
		return $this->resolve_feed( $subscription['url'], false );
	}

	/**
	 * Save ordered and normalized subscription records.
	 *
	 * @param int   $user_id WordPress user ID.
	 * @param array $subscriptions Records.
	 */
	private function save_subscriptions( $user_id, array $subscriptions ) {
		foreach ( $subscriptions as $index => &$subscription ) {
			$subscription['order'] = $index;
		}
		unset( $subscription );
		update_user_meta( $user_id, self::META_SUBSCRIPTIONS, array_values( $subscriptions ) );
	}

	/**
	 * Read the persisted item-read map.
	 *
	 * @param int $user_id WordPress user ID.
	 * @return array
	 */
	private function get_read_state( $user_id ) {
		$value = get_user_meta( $user_id, self::META_READ_ITEMS, true );
		return is_array( $value ) ? $value : array();
	}

	/**
	 * Persist the item-read map.
	 *
	 * @param int   $user_id WordPress user ID.
	 * @param array $state   Read state.
	 */
	private function save_read_state( $user_id, array $state ) {
		update_user_meta( $user_id, self::META_READ_ITEMS, $state );
	}

	/**
	 * Return supported user preferences with defaults.
	 *
	 * @param int $user_id WordPress user ID.
	 * @return array
	 */
	private function get_preferences( $user_id ) {
		$value = get_user_meta( $user_id, self::META_PREFERENCES, true );
		$value = is_array( $value ) ? $value : array();
		return array(
			'soundEnabled' => ! empty( $value['soundEnabled'] ),
		);
	}

	/**
	 * Derive unique group labels in subscription order.
	 *
	 * @param array $subscriptions Subscription records.
	 * @return array
	 */
	private function groups_from_subscriptions( array $subscriptions ) {
		$groups = array();
		foreach ( $subscriptions as $subscription ) {
			$groups[] = $subscription['group'];
		}
		return array_values( array_unique( $groups ) );
	}

	/**
	 * Find a subscription's numeric position.
	 *
	 * @param array  $subscriptions Records.
	 * @param string $subscription_id UUID.
	 * @return int|null
	 */
	private function find_subscription_index( array $subscriptions, $subscription_id ) {
		foreach ( $subscriptions as $index => $subscription ) {
			if ( hash_equals( (string) $subscription['id'], (string) $subscription_id ) ) {
				return $index;
			}
		}
		return null;
	}

	/**
	 * Build the bounded transient key for a feed URL.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	private function cache_key( $url ) {
		return 'feed_buddy_' . md5( untrailingslashit( strtolower( $url ) ) );
	}

	/**
	 * Return the standard missing-subscription response.
	 *
	 * @return WP_Error
	 */
	private function not_found_error() {
		return new WP_Error(
			'feed_buddy_subscription_not_found',
			__( 'That feed is no longer in your buddy list.', 'desktop-mode-feed-buddy' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Convert internal errors into bounded user-facing copy.
	 *
	 * @param WP_Error $error Error.
	 * @return string
	 */
	private function public_error_message( WP_Error $error ) {
		$known = array(
			'feed_buddy_http_failed',
			'feed_buddy_http_status',
			'feed_buddy_response_too_large',
			'feed_buddy_not_a_feed',
		);
		return in_array( $error->get_error_code(), $known, true )
			? $error->get_error_message()
			: __( 'SOL Inbound Monologue could not refresh this feed.', 'desktop-mode-feed-buddy' );
	}
}
