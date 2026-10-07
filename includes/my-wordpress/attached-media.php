<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_register_attached_media_field() {
	$types = openstation_my_wordpress_rest_field_post_types();
	foreach ( $types as $type ) {
		if ( 'attachment' === $type ) {
			continue;
		}
		register_rest_field(
			$type,
			'openstation_attached_media',
			array(
				'get_callback' => static function ( $post ) {
					$id = isset( $post['id'] ) ? (int) $post['id'] : 0;
					return openstation_my_wordpress_post_attached_media( $id );
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_attached_media_field' );

function openstation_my_wordpress_post_attached_media( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return array();
	}
	$post = get_post( $post_id );
	if ( ! $post ) {
		return array();
	}

	$ids = array();

	$thumb = (int) get_post_thumbnail_id( $post_id );
	if ( $thumb > 0 ) {
		$ids[ $thumb ] = true;
	}

	$content = isset( $post->post_content ) ? (string) $post->post_content : '';
	if ( '' !== $content ) {

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

		if ( preg_match_all( '/<img[^>]+src=["\']([^"\']+)["\']/', $content, $m ) ) {
			$seen_urls = array();
			foreach ( $m[1] as $url ) {
				$url = (string) $url;
				if ( '' === $url || isset( $seen_urls[ $url ] ) ) {
					continue;
				}
				$seen_urls[ $url ] = true;
				$resolved          = openstation_my_wordpress_resolve_attachment_url( $url );
				if ( $resolved > 0 ) {
					$ids[ $resolved ] = true;
				}
			}
		}
	}

	$out = array_map( 'intval', array_keys( $ids ) );

	$filtered = apply_filters( 'openstation_my_wordpress_attached_media', $out, $post_id );

	if ( ! is_array( $filtered ) ) {
		return $out;
	}

	$dedup = array();
	foreach ( $filtered as $id ) {
		$id = (int) $id;
		if ( $id > 0 ) {
			$dedup[ $id ] = true;
		}
	}
	return array_map( 'intval', array_keys( $dedup ) );
}

function openstation_my_wordpress_resolve_attachment_url( $url ) {
	static $cache = array();
	$url          = (string) $url;
	if ( '' === $url ) {
		return 0;
	}
	if ( isset( $cache[ $url ] ) ) {
		return (int) $cache[ $url ];
	}

	$strip_query = static function ( $u ) {
		$pos = strpos( $u, '?' );
		return false === $pos ? $u : substr( $u, 0, $pos );
	};

	$clean      = $strip_query( $url );
	$candidates = array( $clean );

	if ( preg_match( '/^(.*)-\d+x\d+(\.[a-zA-Z0-9]+)$/', $clean, $m ) ) {
		$candidates[] = $m[1] . $m[2];
	}

	if ( preg_match( '/^(.*)-scaled(\.[a-zA-Z0-9]+)$/', $clean, $m ) ) {
		$candidates[] = $m[1] . $m[2];
	}

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
