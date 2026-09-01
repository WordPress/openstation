<?php
/**
 * My WordPress — the queries and the item dossier.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. This part owns what a section
 * CONTAINS: the `WP_Query` / `WP_User_Query` pages, the per-item
 * authorization, the root-tile counts, and the detail-pane dossier.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const PER_PAGE       = 24;
const MEDIA_PER_PAGE = 48;

/**
 * Whether the acting user may edit / trash one item.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Item id.
 * @param string              $verb    `edit` | `delete`.
 * @return bool
 */
function allowed( Os $os, array $section, $id, $verb ) {
	$woo = woo_allowed( $section, (int) $id, $verb );
	if ( null !== $woo ) {
		return $woo;
	}
	if ( 'user' === $section['kind'] ) {
		return 'edit' === $verb && $os->can( 'edit_user', (int) $id );
	}
	return $os->can( $verb . '_post', (int) $id );
}

/**
 * The name of whoever holds the edit lock on a post, '' when free.
 * WP Explorer's lock payload, reused.
 *
 * @param int $post_id Post id.
 * @return string
 */
function lock_holder( $post_id ) {
	if ( ! function_exists( 'openstation_my_wordpress_post_lock_payload' ) ) {
		return '';
	}
	$lock = openstation_my_wordpress_post_lock_payload( (int) $post_id );
	if ( is_array( $lock ) && ! empty( $lock['locked'] ) && ! empty( $lock['name'] ) ) {
		return (string) $lock['name'];
	}
	return '';
}

/**
 * The REST-visible extras plugin JS reads off a `wp/v2` row: the
 * registered `show_in_rest` meta values under `meta`, and one
 * term-id array per REST-exposed taxonomy, keyed by its `rest_base`
 * — the exact fields WP Explorer's rows carry, which is what the
 * shared `os.my-wordpress.*` hook subscribers (band assigners,
 * preview-extras painters) read their facts from.
 *
 * @param \WP_Post $post Post.
 * @return array<string,mixed>
 */
function rest_extras( \WP_Post $post ) {
	$meta = array();
	foreach ( get_registered_meta_keys( 'post', (string) $post->post_type ) as $key => $args ) {
		if ( ! empty( $args['show_in_rest'] ) ) {
			$meta[ $key ] = get_post_meta( $post->ID, $key, true );
		}
	}
	// An empty PHP array JSON-encodes as `[]`; subscribers index
	// `item.meta[ key ]`, which wants an object either way.
	$extras = array( 'meta' => array() === $meta ? new \stdClass() : $meta );
	foreach ( get_object_taxonomies( $post->post_type, 'objects' ) as $taxonomy ) {
		if ( empty( $taxonomy->show_in_rest ) ) {
			continue;
		}
		$base = isset( $taxonomy->rest_base ) && '' !== (string) $taxonomy->rest_base
			? (string) $taxonomy->rest_base
			: (string) $taxonomy->name;
		$ids  = wp_get_object_terms( $post->ID, $taxonomy->name, array( 'fields' => 'ids' ) );
		$extras[ $base ] = is_wp_error( $ids ) ? array() : array_map( 'intval', $ids );
	}
	return $extras;
}

/**
 * One page of a section, in the uniform shape the client view
 * renders: `items` (each: `id`, `title`, `subtitle`, `status`,
 * `thumb`, `link`, `mime`, `lockedBy`, `canEdit`, `canDelete`, plus
 * the REST-visible extras for post kinds), `total`, `pages`, `page`.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State (`query`, `page`, `sort`).
 * @return array{items:array[],total:int,pages:int,page:int}
 */
function fetch( Os $os, array $section, State $state ) {
	// The Woo sections own their pages whole: Orders walk the status
	// bands through `wc_get_orders()` (HPOS keeps them out of
	// `wp_posts`), Customers replay the band-and-spend plan.
	$woo_page = woo_list( $os, $section, $state );
	if ( null !== $woo_page ) {
		return $woo_page;
	}

	$query              = (string) $state->get( 'query' );
	$page               = max( 1, (int) $state->get( 'page' ) );
	list( $by, $order ) = sort_of( $section, $state );

	if ( 'user' === $section['kind'] ) {
		$users = new \WP_User_Query(
			array(
				'number'      => PER_PAGE,
				'offset'      => ( $page - 1 ) * PER_PAGE,
				'search'      => '' !== $query ? '*' . $query . '*' : '',
				// The ID tiebreak is load-bearing: rows equal on the
				// primary sort (duplicate display names, same-second
				// registrations) have NO defined order without it, so
				// each page's query may resort the whole set differently
				// and an infinite-scrolled list visibly reshuffles as
				// pages land.
				'orderby'     => array(
					$by   => $order,
					'ID'  => 'ASC',
				),
				'count_total' => true,
			)
		);
		$items = array();
		foreach ( $users->get_results() as $user ) {
			$items[] = array(
				'id'        => (int) $user->ID,
				'title'     => (string) $user->display_name,
				// The REST spelling too — the shared seam subscribers
				// were written against `/wp/v2/users` rows.
				'name'      => (string) $user->display_name,
				'subtitle'  => (string) $user->user_email,
				'status'    => implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ),
				'excerpt'   => '',
				'thumb'     => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
				'link'      => esc_url_raw( get_author_posts_url( $user->ID ) ),
				'mime'      => '',
				'lockedBy'  => '',
				'canEdit'   => allowed( $os, $section, (int) $user->ID, 'edit' ),
				'canDelete' => false,
			);
			// Lifetime spend on the built-in Users folder too — on a
			// store, "who is this person" and "what have they spent"
			// are the same question. Empty without WooCommerce.
			$items[ count( $items ) - 1 ] += woo_user_extras( (int) $user->ID );
		}
		$total = (int) $users->get_total();
		return array(
			'items'   => $items,
			'total'   => $total,
			'pages'   => max( 1, (int) ceil( $total / PER_PAGE ) ),
			'page'    => $page,
			'perPage' => PER_PAGE,
		);
	}

	$is_media = 'media' === $section['kind'];
	$per_page = $is_media ? MEDIA_PER_PAGE : PER_PAGE;
	$args     = array(
		'post_type'      => (string) $section['post_type'],
		'post_status'    => $is_media ? 'inherit' : statuses(),
		's'              => $query,
		'posts_per_page' => $per_page,
		'paged'          => $page,
		// ID tiebreak: demo and imported content routinely shares
		// one post_date to the second, and equal rows have no
		// defined order — each page could resort the set and the
		// infinite scroll would reshuffle. See the user query above.
		'orderby'        => array(
			$by  => $order,
			'ID' => 'DESC',
		),
	);
	// Products and Coupons arrive in band order, decided server-side
	// by the same cached plans that order them for WP Explorer.
	$posts = new \WP_Query( woo_query_args( $args, $section, $state ) );
	$items    = array();
	foreach ( $posts->posts as $post ) {
		$items[] = array(
			'id'        => (int) $post->ID,
			'title'     => '' !== $post->post_title ? (string) $post->post_title : __( '(no title)', 'desktop-mode' ),
			'subtitle'  => $is_media
				? (string) $post->post_mime_type
				: sprintf(
					/* translators: 1: author display name, 2: date. */
					__( '%1$s — %2$s', 'desktop-mode' ),
					(string) get_the_author_meta( 'display_name', (int) $post->post_author ),
					(string) get_the_date( '', $post )
				),
			'status'    => $is_media ? '' : (string) $post->post_status,
			// For the hover card — the original tooltip's excerpt,
			// already clamped to the 240 characters it shows.
			'excerpt'   => $is_media
				? ''
				: mb_substr( wp_strip_all_tags( (string) get_the_excerpt( $post ) ), 0, 240 ),
			'thumb'     => ! empty( $section['thumbnails'] )
				? ( $is_media
					? (string) wp_get_attachment_image_url( $post->ID, 'medium' )
					: (string) get_the_post_thumbnail_url( $post, 'thumbnail' ) )
				: '',
			'link'      => esc_url_raw( $is_media ? (string) wp_get_attachment_url( $post->ID ) : (string) get_permalink( $post ) ),
			'mime'      => $is_media ? (string) $post->post_mime_type : '',
			'lockedBy'  => $is_media ? '' : lock_holder( $post->ID ),
			'canEdit'   => allowed( $os, $section, (int) $post->ID, 'edit' ),
			'canDelete' => allowed( $os, $section, (int) $post->ID, 'delete' ),
		);
		if ( ! $is_media ) {
			// The base keys stay authoritative: an extras key that
			// collides with one of ours (a taxonomy rest_base named
			// `status`, say) must not overwrite it.
			$items[ count( $items ) - 1 ] += rest_extras( $post );
			// The `openstation_woo` facts the shared band assigner and
			// stock-ribbon decorator read. Empty without WooCommerce.
			$items[ count( $items ) - 1 ] += woo_extras( $post );
		}
	}
	return array(
		'items'   => $items,
		'total'   => (int) $posts->found_posts,
		'pages'   => max( 1, (int) $posts->max_num_pages ),
		'page'    => $page,
		'perPage' => $per_page,
	);
}

/**
 * How many things a section holds, for the root tiles.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @return int
 */
function count_of( array $section ) {
	$woo = woo_count( $section );
	if ( null !== $woo ) {
		return $woo;
	}
	if ( 'agent' === $section['kind'] ) {
		// Zero while the framework is off: the five shipped agents are
		// only seeded when the flag flips, so none of them exist yet.
		return function_exists( 'openstation_agent_get_agents' )
			? count( openstation_agent_get_agents() )
			: 0;
	}
	if ( 'user' === $section['kind'] ) {
		$counts = count_users();
		return (int) $counts['total_users'];
	}
	$counts = wp_count_posts( (string) $section['post_type'] );
	if ( 'media' === $section['kind'] ) {
		return (int) ( $counts->inherit ?? 0 );
	}
	$total = 0;
	foreach ( statuses() as $status ) {
		$total += (int) ( $counts->$status ?? 0 );
	}
	return $total;
}

/**
 * The admin URL that edits one item of a section.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Item id.
 * @return string
 */
function edit_url( array $section, $id ) {
	$woo = woo_edit_url( $section, (int) $id );
	if ( '' !== $woo ) {
		return $woo;
	}
	if ( 'user' === $section['kind'] ) {
		return admin_url( 'user-edit.php?user_id=' . (int) $id );
	}
	return admin_url( 'post.php?post=' . (int) $id . '&action=edit' );
}

/**
 * The dossier payload for the open item — everything the detail pane
 * paints, per kind.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Item id.
 * @return array<string,mixed>|null Null when the item vanished.
 */
function detail( Os $os, array $section, $id ) {
	if ( woo_section_is( $section, 'wc-orders' ) ) {
		return woo_detail( $section, $id );
	}
	if ( 'user' === $section['kind'] ) {
		$user = get_userdata( $id );
		if ( ! $user ) {
			return null;
		}
		// The third element tags each fact with WP Explorer's dossier
		// section id, so the shared
		// `os.my-wordpress.user-dossier-sections` filter can drop the
		// publishing blocks — a customer's Posts count is four zeroes
		// above the number the merchant actually came for.
		return array(
			'kind'      => 'user',
			'id'        => $id,
			'title'     => (string) $user->display_name,
			'avatar'    => (string) get_avatar_url( $id, array( 'size' => 192 ) ),
			'facts'     => array_values(
				array_filter(
					array(
						array( __( 'Email', 'desktop-mode' ), (string) $user->user_email, 'bio' ),
						array( __( 'Role', 'desktop-mode' ), implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ), 'bio' ),
						array( __( 'Registered', 'desktop-mode' ), (string) date_i18n( get_option( 'date_format' ), strtotime( $user->user_registered ) ), 'bio' ),
						array( __( 'Posts', 'desktop-mode' ), number_format_i18n( count_user_posts( $id ) ), 'stats' ),
						array(
							__( 'Comments', 'desktop-mode' ),
							number_format_i18n(
								(int) get_comments(
									array(
										'user_id' => $id,
										'count'   => true,
									)
								)
							),
							'stats',
						),
					),
					static function ( $fact ) {
						return '' !== $fact[1];
					}
				)
			),
			'canEdit'   => allowed( $os, $section, $id, 'edit' ),
			'canDelete' => false,
		);
	}

	$post = get_post( $id );
	if ( ! $post || $post->post_type !== $section['post_type'] ) {
		return null;
	}
	$title = '' !== $post->post_title ? (string) $post->post_title : __( '(no title)', 'desktop-mode' );

	if ( 'media' === $section['kind'] ) {
		$file  = get_attached_file( $id );
		$meta  = (array) wp_get_attachment_metadata( $id );
		$used  = array();
		if ( function_exists( 'openstation_my_wordpress_media_usage_build' ) ) {
			foreach ( array_slice( (array) ( openstation_my_wordpress_media_usage_build( $post )['usedIn'] ?? array() ), 0, 12 ) as $row ) {
				$used[] = array(
					'title'  => (string) ( $row['title'] ?? '' ),
					'usedAs' => (string) ( $row['usedAs'] ?? '' ),
				);
			}
		}
		return array(
			'kind'      => 'media',
			'id'        => $id,
			'title'     => $title,
			'mime'      => (string) $post->post_mime_type,
			'image'     => (string) wp_get_attachment_image_url( $id, 'large' ),
			'full'      => (string) wp_get_attachment_image_url( $id, 'full' ),
			'facts'     => array_values(
				array_filter(
					array(
						array( __( 'Type', 'desktop-mode' ), (string) $post->post_mime_type ),
						array( __( 'Size', 'desktop-mode' ), $file && file_exists( $file ) ? (string) size_format( (int) filesize( $file ) ) : '' ),
						array(
							__( 'Dimensions', 'desktop-mode' ),
							isset( $meta['width'], $meta['height'] ) ? $meta['width'] . ' × ' . $meta['height'] : '',
						),
						array( __( 'Uploaded', 'desktop-mode' ), (string) get_the_date( '', $post ) ),
					),
					static function ( $fact ) {
						return '' !== $fact[1];
					}
				)
			),
			'usedIn'    => $used,
			'canEdit'   => allowed( $os, $section, $id, 'edit' ),
			'canDelete' => allowed( $os, $section, $id, 'delete' ),
		);
	}

	// The rendered body — what WP Explorer's preview pane shows.
	// Server-rendered, admin-trusted, injected verbatim by the client.
	// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Applying Core's own content pipeline (blocks, shortcodes, embeds), not declaring a hook.
	$content = apply_filters( 'the_content', (string) $post->post_content );

	return array(
		'kind'      => 'post',
		'id'        => $id,
		'title'     => $title,
		'image'     => (string) get_the_post_thumbnail_url( $post, 'large' ),
		'content'   => (string) $content,
		'lockedBy'  => lock_holder( $id ),
		'facts'     => array_values(
			array_filter(
				array(
					array( __( 'Status', 'desktop-mode' ), ucfirst( (string) $post->post_status ) ),
					array( __( 'Author', 'desktop-mode' ), (string) get_the_author_meta( 'display_name', (int) $post->post_author ) ),
					array( __( 'Published', 'desktop-mode' ), (string) get_the_date( '', $post ) ),
					array( __( 'Modified', 'desktop-mode' ), (string) get_the_modified_date( '', $post ) ),
					array( __( 'Words', 'desktop-mode' ), number_format_i18n( str_word_count( wp_strip_all_tags( (string) $post->post_content ) ) ) ),
				),
				static function ( $fact ) {
					return '' !== $fact[1];
				}
			)
		),
		'canEdit'   => allowed( $os, $section, $id, 'edit' ),
		'canDelete' => allowed( $os, $section, $id, 'delete' ),
	);
}
