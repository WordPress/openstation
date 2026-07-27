<?php
/**
 * Desktop Mode — My WordPress: per-post attached-media REST field.
 *
 * Registers `desktop_mode_attached_media` on every public post
 * type. Returns the canonical set of attachment ids referenced by
 * the post — featured image + everything in `post_content` —
 * computed server-side where `attachment_url_to_postid()` is
 * available.
 *
 * Why server-side: a client regex over `content.rendered` catches
 * the common `class="wp-image-N"` Gutenberg case, but misses:
 *   - Raw `<img src="…">` inserted via cross-window drag-bridge,
 *     plugin importers, or hand-edits with no `wp-image-N` class.
 *   - Gallery items that store the id in `data-id` / `data-
 *     attachment-id`.
 *   - Classic-editor `[caption id="attachment_N"]` shortcodes
 *     that render through `the_content` without re-emitting an
 *     `wp-image-N` class.
 *
 * Server has the full post object + WP core's URL→id resolver, so
 * one round-trip per detail-view fetches an authoritative list.
 *
 * Filterable via `desktop_mode_my_wordpress_attached_media` for
 * plugins (page builders, ACF, custom field handlers) to append
 * their own references.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register `desktop_mode_attached_media` on every public post type.
 */
function desktop_mode_my_wordpress_register_attached_media_field() {
	$types = get_post_types(
		array(
			'show_in_rest' => true,
			'public'       => true,
		),
		'names'
	);
	foreach ( $types as $type ) {
		if ( 'attachment' === $type ) {
			continue;
		}
		register_rest_field(
			$type,
			'desktop_mode_attached_media',
			array(
				'get_callback' => static function ( $post ) {
					$id = isset( $post['id'] ) ? (int) $post['id'] : 0;
					return desktop_mode_my_wordpress_post_attached_media( $id );
				},
				'schema'       => array(
					'description' => __( 'Attachment ids referenced by this post — featured image plus every attachment found in post_content (block-class scan + raw `<img src>` URL resolution).', 'desktop-mode' ),
					'type'        => 'array',
					'items'       => array( 'type' => 'integer' ),
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_attached_media_field' );

/**
 * Resolve every attachment referenced by `$post_id`. Featured
 * image + a multi-pass scan of `post_content`:
 *
 *   1. `wp-image-N` class on any element.
 *   2. `id="attachment_N"` (classic-editor caption shortcode).
 *   3. `data-id="N"` and `data-attachment-id="N"` (gallery
 *      formats, Jetpack tiled-gallery, several SEO plugins).
 *   4. Raw `<img src="…">` URLs resolved via `attachment_url_to_postid()`.
 *      Resolver results are cached in-process so a post embedding
 *      the same image twice only takes one DB hit per URL.
 *
 * @param int $post_id Post id.
 * @return int[] Attachment ids, deduped, no order guarantee.
 */
function desktop_mode_my_wordpress_post_attached_media( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return array();
	}
	$post = get_post( $post_id );
	if ( ! $post ) {
		return array();
	}

	$ids = array();

	// Featured image.
	$thumb = (int) get_post_thumbnail_id( $post_id );
	if ( $thumb > 0 ) {
		$ids[ $thumb ] = true;
	}

	$content = isset( $post->post_content ) ? (string) $post->post_content : '';
	if ( '' !== $content ) {
		// Pass 1: explicit class / id / data-attribute patterns.
		$patterns = array(
			'/wp-image-(\d+)/',
			'/id="attachment_(\d+)"/',
			"/data-id=['\"](\d+)['\"]/",
			"/data-attachment-id=['\"](\d+)['\"]/",
		);
		foreach ( $patterns as $pattern ) {
			if ( preg_match_all( $pattern, $content, $m ) ) {
				foreach ( $m[1] as $raw ) {
					$id = (int) $raw;
					if ( $id > 0 ) {
						$ids[ $id ] = true;
					}
				}
			}
		}

		// Pass 2: resolve `<img src="…">` URLs. Catches images that
		// none of the above patterns tagged — the cross-window
		// drag-bridge insertion path being the canonical example.
		if ( preg_match_all( '/<img[^>]+src=["\']([^"\']+)["\']/', $content, $m ) ) {
			$seen_urls = array();
			foreach ( $m[1] as $url ) {
				$url = (string) $url;
				if ( '' === $url || isset( $seen_urls[ $url ] ) ) {
					continue;
				}
				$seen_urls[ $url ] = true;
				$resolved = desktop_mode_my_wordpress_resolve_attachment_url( $url );
				if ( $resolved > 0 ) {
					$ids[ $resolved ] = true;
				}
			}
		}
	}

	$out = array_map( 'intval', array_keys( $ids ) );

	/**
	 * Filter the per-post attached-media id list.
	 *
	 * Plugins that store attachment references outside `post_content`
	 * (ACF image fields, page-builder block storage, post-meta
	 * galleries) can append their ids here.
	 *
	 * @param int[] $out      Attachment ids resolved by the core scan.
	 * @param int   $post_id  Subject post id.
	 */
	$filtered = apply_filters( 'desktop_mode_my_wordpress_attached_media', $out, $post_id );

	if ( ! is_array( $filtered ) ) {
		return $out;
	}
	// Sanitize: positive integers, deduped.
	$dedup = array();
	foreach ( $filtered as $id ) {
		$id = (int) $id;
		if ( $id > 0 ) {
			$dedup[ $id ] = true;
		}
	}
	return array_map( 'intval', array_keys( $dedup ) );
}

/**
 * In-request URL→attachment-id cache. `attachment_url_to_postid`
 * runs a SQL query per call; a post that embeds the same image
 * multiple times (gallery + cover + content) would otherwise pay
 * for each occurrence.
 *
 * @param string $url Image URL pulled from `<img src>`.
 * @return int Attachment id, or 0 when no match.
 */
function desktop_mode_my_wordpress_resolve_attachment_url( $url ) {
	static $cache = array();
	$url = (string) $url;
	if ( '' === $url ) {
		return 0;
	}
	if ( isset( $cache[ $url ] ) ) {
		return (int) $cache[ $url ];
	}
	// `attachment_url_to_postid()` does a literal `_wp_attached_file`
	// meta lookup — it doesn't account for WP-generated variants:
	//
	//   - Sized intermediates  `image-300x200.jpg` — strip `-WxH`.
	//   - `-scaled.jpg`        WP autogenerates this for uploads
	//                          past the big-image threshold and
	//                          stores it as `_wp_attached_file`,
	//                          while editors emit the original
	//                          URL in `<img src>`. Try BOTH the
	//                          scaled→original strip AND the
	//                          original→scaled append.
	//
	// Strip query strings from every candidate so cache-buster URLs
	// (`?ver=…`) still resolve.
	$strip_query = static function ( $u ) {
		$pos = strpos( $u, '?' );
		return false === $pos ? $u : substr( $u, 0, $pos );
	};

	$clean = $strip_query( $url );
	$candidates = array( $clean );

	// `image-300x200.jpg` → `image.jpg`
	if ( preg_match( '/^(.*)-\d+x\d+(\.[a-zA-Z0-9]+)$/', $clean, $m ) ) {
		$candidates[] = $m[1] . $m[2];
	}
	// `image-scaled.jpg` → `image.jpg`
	if ( preg_match( '/^(.*)-scaled(\.[a-zA-Z0-9]+)$/', $clean, $m ) ) {
		$candidates[] = $m[1] . $m[2];
	}
	// `image.jpg` → `image-scaled.jpg` (post emits original, meta
	// stores scaled — the most common drag-bridge insertion path).
	if ( preg_match( '/^(.*)(\.[a-zA-Z0-9]+)$/', $clean, $m )
		&& ! preg_match( '/-scaled$/', $m[1] )
	) {
		$candidates[] = $m[1] . '-scaled' . $m[2];
	}

	$resolved = 0;
	foreach ( $candidates as $candidate ) {
		$id = (int) attachment_url_to_postid( $candidate );
		if ( $id > 0 ) {
			$resolved = $id;
			break;
		}
	}
	$cache[ $url ] = $resolved;
	return $resolved;
}
