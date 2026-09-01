<?php
/**
 * My WordPress — the content explorer, as an OpenStation app.
 *
 * The full WP Explorer surface on the App Framework, split the way
 * the framework splits: THIS file is the window and the truth — the
 * section registry (builtins + every eligible custom post type with
 * its plugin-group folder, discovered through the same
 * `openstation_my_wordpress_*` helpers WP Explorer uses), the
 * queries (`WP_Query` / `WP_User_Query`, not `wp/v2/*` REST from the
 * browser), per-item authorization, the mutating actions (trash,
 * bulk trash, open-in-editor) and the preview-action descriptors.
 * The BODY lives in `my-wordpress.os.ts` beside it: a client view
 * where selection (click / ctrl / shift / marquee), infinite scroll,
 * drag-out to the desktop, the context menu, media zoom and every
 * repaint are instant — no request for anything the browser already
 * knows. `watch( '*' )` repaints the window whenever any other
 * window changes any content.
 *
 * Plugin surfaces are shared with WP Explorer, not forked: CPT
 * discovery honours `openstation_my_wordpress_post_types` /
 * `_post_type_entity` / `_post_type_groups`, and the preview-action
 * pipeline consumes the same `openstation_my_wordpress_preview_actions`
 * descriptors and the same `os.my-wordpress.preview-actions` JS
 * filter — an action written for WP Explorer appears here unchanged.
 * This is a sibling of WP Explorer (`desktop-mode-my-wordpress`),
 * not a replacement.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const PER_PAGE       = 24;
const MEDIA_PER_PAGE = 48;

/** A folder wearing the OpenStation mark — the explorer family icon. */
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M11 13h12.2a3 3 0 0 1 2.4 1.2l2.8 3.7a3 3 0 0 0 2.4 1.2H53a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="35.6" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 30.6v10M27.4 33l4.6 7.6 4.6-7.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ------------------------------------------------------------ sections

/**
 * Every section the current user may browse: the four builtins plus
 * one per eligible custom post type, carrying the same group fields
 * WP Explorer computes (`group`, `groupLabel`, `groupIcon`,
 * `groupOrder`) so plugin CPTs fold into plugin folders at the root.
 *
 * @param Os $os Host handle.
 * @return array<int,array<string,mixed>>
 */
function sections( Os $os ) {
	$sections = array(
		array(
			'id'         => 'posts',
			'label'      => __( 'Posts', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-post',
			'kind'       => 'post',
			'post_type'  => 'post',
			'capability' => 'edit_posts',
			'thumbnails' => true,
		),
		array(
			'id'         => 'pages',
			'label'      => __( 'Pages', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-page',
			'kind'       => 'post',
			'post_type'  => 'page',
			'capability' => 'edit_pages',
			'thumbnails' => true,
		),
		array(
			'id'         => 'media',
			'label'      => __( 'Media', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-media',
			'kind'       => 'media',
			'post_type'  => 'attachment',
			'capability' => 'upload_files',
			'thumbnails' => true,
		),
		array(
			'id'         => 'users',
			'label'      => __( 'Users', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-users',
			'kind'       => 'user',
			'post_type'  => '',
			'capability' => 'list_users',
			'thumbnails' => true,
		),
	);

	// Every eligible CPT, through the same discovery WP Explorer uses —
	// one list of what the site contains, two windows rendering it.
	if ( function_exists( 'openstation_my_wordpress_eligible_post_types' ) ) {
		foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {
			$group      = function_exists( 'openstation_my_wordpress_post_type_group' )
				? openstation_my_wordpress_post_type_group( $name )
				: null;
			$sections[] = array(
				'id'         => 'cpt-' . $name,
				'label'      => isset( $post_type->labels->name ) && '' !== $post_type->labels->name
					? (string) $post_type->labels->name
					: (string) $name,
				'icon'       => function_exists( 'openstation_my_wordpress_post_type_icon' )
					? openstation_my_wordpress_post_type_icon( $post_type )
					: 'dashicons-admin-post',
				'kind'       => 'post',
				'post_type'  => (string) $name,
				'capability' => (string) $post_type->cap->edit_posts,
				'thumbnails' => post_type_supports( $name, 'thumbnail' ),
				'group'      => $group ? (string) $group['id'] : null,
				'groupLabel' => $group ? (string) $group['label'] : null,
				'groupIcon'  => $group ? (string) $group['icon'] : null,
				'groupOrder' => $group ? (int) $group['order'] : null,
			);
		}
	}

	/**
	 * Filter the sections the My WordPress app offers. Runs on every
	 * render — a post type registered at any point of the bootstrap
	 * can appear, unlike a list frozen at registration time.
	 *
	 * @param array[] $sections Each: `id`, `label`, `icon`, `kind`
	 *                          (`post` | `media` | `user`), `post_type`,
	 *                          `capability`, `thumbnails`, and the
	 *                          optional `group*` folder fields.
	 */
	$sections = (array) $os->filter( 'openstation_my_wordpress_app_sections', $sections );

	return array_values(
		array_filter(
			$sections,
			static function ( $section ) use ( $os ) {
				return is_array( $section ) && ! empty( $section['id'] )
					&& ( empty( $section['capability'] ) || $os->can( (string) $section['capability'] ) );
			}
		)
	);
}

/**
 * One section by id, or null.
 *
 * @param Os     $os Host handle.
 * @param string $id Section id.
 * @return array<string,mixed>|null
 */
function section_of( Os $os, $id ) {
	foreach ( sections( $os ) as $section ) {
		if ( $section['id'] === $id ) {
			return $section;
		}
	}
	return null;
}

/**
 * The plugin folders the grouped sections fold into, through the
 * same collector (and `openstation_my_wordpress_post_type_groups`
 * filter) WP Explorer uses.
 *
 * @param array[] $sections Section descriptors.
 * @return array[] Each: `id`, `label`, `icon`, `order`.
 */
function groups( array $sections ) {
	if ( function_exists( 'openstation_my_wordpress_collect_groups' ) ) {
		return openstation_my_wordpress_collect_groups( $sections );
	}
	$groups = array();
	foreach ( $sections as $section ) {
		if ( ! empty( $section['group'] ) && ! isset( $groups[ $section['group'] ] ) ) {
			$groups[ $section['group'] ] = array(
				'id'    => (string) $section['group'],
				'label' => (string) ( $section['groupLabel'] ?? $section['group'] ),
				'icon'  => (string) ( $section['groupIcon'] ?? 'dashicons-admin-plugins' ),
				'order' => (int) ( $section['groupOrder'] ?? 20 ),
			);
		}
	}
	return array_values( $groups );
}

// ------------------------------------------------------------- queries

/**
 * The statuses the explorer lists: everything an editor works on.
 *
 * @return string[]
 */
function statuses() {
	return array( 'publish', 'future', 'draft', 'pending', 'private' );
}

/**
 * Sort options for a section's kind: `value => [ label, orderby, order ]`.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @return array<string,array{0:string,1:string,2:string}>
 */
function sort_options( array $section ) {
	if ( 'user' === $section['kind'] ) {
		return array(
			'default'    => array( __( 'Name A–Z', 'desktop-mode' ), 'display_name', 'ASC' ),
			'title-desc' => array( __( 'Name Z–A', 'desktop-mode' ), 'display_name', 'DESC' ),
			'newest'     => array( __( 'Recently registered', 'desktop-mode' ), 'registered', 'DESC' ),
		);
	}
	return array(
		'default'    => array( __( 'Newest first', 'desktop-mode' ), 'date', 'DESC' ),
		'oldest'     => array( __( 'Oldest first', 'desktop-mode' ), 'date', 'ASC' ),
		'title-asc'  => array( __( 'Title A–Z', 'desktop-mode' ), 'title', 'ASC' ),
		'title-desc' => array( __( 'Title Z–A', 'desktop-mode' ), 'title', 'DESC' ),
	);
}

/**
 * The (orderby, order) pair the state's `sort` resolves to.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State.
 * @return array{0:string,1:string}
 */
function sort_of( array $section, State $state ) {
	$options = sort_options( $section );
	$picked  = (string) $state->get( 'sort' );
	$row     = $options[ isset( $options[ $picked ] ) ? $picked : 'default' ];
	return array( $row[1], $row[2] );
}

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
 * One page of a section, in the uniform shape the client view
 * renders: `items` (each: `id`, `title`, `subtitle`, `status`,
 * `thumb`, `link`, `mime`, `lockedBy`, `canEdit`, `canDelete`),
 * `total`, `pages`, `page`.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State (`query`, `page`, `sort`).
 * @return array{items:array[],total:int,pages:int,page:int}
 */
function fetch( Os $os, array $section, State $state ) {
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
				'subtitle'  => (string) $user->user_email,
				'status'    => implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ),
				'thumb'     => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
				'link'      => esc_url_raw( get_author_posts_url( $user->ID ) ),
				'mime'      => '',
				'lockedBy'  => '',
				'canEdit'   => allowed( $os, $section, (int) $user->ID, 'edit' ),
				'canDelete' => false,
			);
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
	$posts    = new \WP_Query(
		array(
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
		)
	);
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
	if ( 'user' === $section['kind'] ) {
		$user = get_userdata( $id );
		if ( ! $user ) {
			return null;
		}
		return array(
			'kind'      => 'user',
			'id'        => $id,
			'title'     => (string) $user->display_name,
			'avatar'    => (string) get_avatar_url( $id, array( 'size' => 192 ) ),
			'facts'     => array_values(
				array_filter(
					array(
						array( __( 'Email', 'desktop-mode' ), (string) $user->user_email ),
						array( __( 'Role', 'desktop-mode' ), implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ) ),
						array( __( 'Registered', 'desktop-mode' ), (string) date_i18n( get_option( 'date_format' ), strtotime( $user->user_registered ) ) ),
						array( __( 'Posts', 'desktop-mode' ), number_format_i18n( count_user_posts( $id ) ) ),
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

// -------------------------------------------------- navigate-into

/**
 * The detail FOLDER a post navigates into: the rendered article plus
 * one folder tile per related surface — Author, Contributors,
 * Comments, Categories, Tags, Attached media, Revisions — with live
 * counts. WP Explorer's detail view, as data.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Post id.
 * @return array<string,mixed>|null Null when the post vanished.
 */
function folder( Os $os, array $section, $id ) {
	$post = get_post( $id );
	if ( ! $post || $post->post_type !== $section['post_type'] ) {
		return null;
	}

	$contributors = function_exists( 'openstation_my_wordpress_post_contributors_payload' )
		? openstation_my_wordpress_post_contributors_payload( $id )
		: array();
	$categories   = get_the_terms( $post, 'category' );
	$categories   = is_array( $categories ) ? $categories : array();
	$tags         = get_the_terms( $post, 'post_tag' );
	$tags         = is_array( $tags ) ? $tags : array();
	$media_count  = count(
		get_children(
			array(
				'post_parent' => $id,
				'post_type'   => 'attachment',
				'fields'      => 'ids',
			)
		)
	) + ( has_post_thumbnail( $post ) ? 1 : 0 );
	$comments     = (int) get_comments_number( $post );
	$revisions    = wp_revisions_enabled( $post ) ? count( wp_get_post_revisions( $id, array( 'fields' => 'ids' ) ) ) : 0;

	$folders   = array();
	$folders[] = array(
		'relation' => 'author',
		'label'    => __( 'Author', 'desktop-mode' ),
		'icon'     => 'dashicons-admin-users',
		'count'    => 1,
	);
	if ( array() !== $contributors ) {
		$folders[] = array(
			'relation' => 'contributors',
			'label'    => __( 'Contributors', 'desktop-mode' ),
			'icon'     => 'dashicons-groups',
			'count'    => count( $contributors ),
		);
	}
	$folders[] = array(
		'relation' => 'comments',
		'label'    => __( 'Comments', 'desktop-mode' ),
		'icon'     => 'dashicons-admin-comments',
		'count'    => $comments,
		'disabled' => 0 === $comments && 'closed' === $post->comment_status,
	);
	if ( array() !== $categories ) {
		$folders[] = array(
			'relation' => 'categories',
			'label'    => __( 'Categories', 'desktop-mode' ),
			'icon'     => 'dashicons-category',
			'count'    => count( $categories ),
		);
	}
	if ( array() !== $tags ) {
		$folders[] = array(
			'relation' => 'tags',
			'label'    => __( 'Tags', 'desktop-mode' ),
			'icon'     => 'dashicons-tag',
			'count'    => count( $tags ),
		);
	}
	$folders[] = array(
		'relation' => 'media',
		'label'    => __( 'Attached media', 'desktop-mode' ),
		'icon'     => 'dashicons-format-image',
		'count'    => $media_count,
	);
	$folders[] = array(
		'relation' => 'revisions',
		'label'    => __( 'Revisions', 'desktop-mode' ),
		'icon'     => 'dashicons-backup',
		'count'    => $revisions,
	);

	return array(
		'id'      => $id,
		'title'   => '' !== $post->post_title ? (string) $post->post_title : __( '(no title)', 'desktop-mode' ),
		'status'  => (string) $post->post_status,
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Applying Core's own content pipeline, not declaring a hook.
		'content' => (string) apply_filters( 'the_content', (string) $post->post_content ),
		'folders' => $folders,
	);
}

/**
 * The rows inside one relation sub-folder. Uniform shape: `id`,
 * `title`, `subtitle`, `icon` | `thumb`, `editUrl`.
 *
 * @param Os                  $os       Host handle.
 * @param array<string,mixed> $section  Section descriptor.
 * @param int                 $id       Post id.
 * @param string              $relation Relation slug.
 * @return array{label:string,rows:array[]}|null
 */
function sub( Os $os, array $section, $id, $relation ) {
	$post = get_post( $id );
	if ( ! $post || $post->post_type !== $section['post_type'] ) {
		return null;
	}
	$rows  = array();
	$label = '';

	$user_row = static function ( $user_id, $name = '', $avatar = '' ) {
		$user = get_userdata( (int) $user_id );
		return array(
			'id'       => (int) $user_id,
			'title'    => '' !== $name ? $name : ( $user ? (string) $user->display_name : sprintf( '#%d', $user_id ) ),
			'subtitle' => $user ? (string) $user->user_email : '',
			'thumb'    => '' !== $avatar ? $avatar : (string) get_avatar_url( (int) $user_id, array( 'size' => 96 ) ),
			'editUrl'  => current_user_can( 'edit_user', (int) $user_id )
				? admin_url( 'user-edit.php?user_id=' . (int) $user_id )
				: '',
		);
	};

	switch ( $relation ) {
		case 'author':
			$label  = __( 'Author', 'desktop-mode' );
			$rows[] = $user_row( (int) $post->post_author );
			break;
		case 'contributors':
			$label = __( 'Contributors', 'desktop-mode' );
			if ( function_exists( 'openstation_my_wordpress_post_contributors_payload' ) ) {
				foreach ( openstation_my_wordpress_post_contributors_payload( $id ) as $person ) {
					$rows[] = $user_row( $person['userId'], $person['userName'], $person['userAvatarUrl'] );
				}
			}
			break;
		case 'comments':
			$label = __( 'Comments', 'desktop-mode' );
			foreach ( get_comments(
				array(
					'post_id' => $id,
					'number'  => 100,
				)
			) as $comment ) {
				$rows[] = array(
					'id'       => (int) $comment->comment_ID,
					'title'    => (string) $comment->comment_author,
					'subtitle' => wp_trim_words( wp_strip_all_tags( (string) $comment->comment_content ), 12 ),
					'icon'     => 'dashicons-admin-comments',
					'editUrl'  => current_user_can( 'edit_comment', (int) $comment->comment_ID )
						? admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID )
						: '',
				);
			}
			break;
		case 'categories':
		case 'tags':
			$taxonomy = 'tags' === $relation ? 'post_tag' : 'category';
			$label    = 'tags' === $relation ? __( 'Tags', 'desktop-mode' ) : __( 'Categories', 'desktop-mode' );
			$terms    = get_the_terms( $post, $taxonomy );
			foreach ( is_array( $terms ) ? $terms : array() as $term ) {
				$rows[] = array(
					'id'       => (int) $term->term_id,
					'title'    => (string) $term->name,
					'subtitle' => sprintf(
						/* translators: %s: entry count. */
						_n( '%s entry', '%s entries', (int) $term->count, 'desktop-mode' ),
						number_format_i18n( (int) $term->count )
					),
					'icon'     => 'tags' === $relation ? 'dashicons-tag' : 'dashicons-category',
					'editUrl'  => current_user_can( 'manage_categories' )
						? admin_url( 'term.php?taxonomy=' . $taxonomy . '&tag_ID=' . (int) $term->term_id )
						: '',
				);
			}
			break;
		case 'media':
			$label = __( 'Attached media', 'desktop-mode' );
			$ids   = get_children(
				array(
					'post_parent' => $id,
					'post_type'   => 'attachment',
					'fields'      => 'ids',
				)
			);
			$ids   = array_map( 'intval', array_keys( $ids ) );
			if ( has_post_thumbnail( $post ) ) {
				$ids[] = (int) get_post_thumbnail_id( $post );
			}
			foreach ( array_unique( $ids ) as $media_id ) {
				$media = get_post( $media_id );
				if ( ! $media ) {
					continue;
				}
				$rows[] = array(
					'id'       => $media_id,
					'title'    => '' !== $media->post_title ? (string) $media->post_title : sprintf( '#%d', $media_id ),
					'subtitle' => (string) $media->post_mime_type,
					'thumb'    => (string) wp_get_attachment_image_url( $media_id, 'medium' ),
					'icon'     => 'dashicons-format-image',
					'editUrl'  => current_user_can( 'edit_post', $media_id )
						? admin_url( 'post.php?post=' . $media_id . '&action=edit' )
						: '',
				);
			}
			break;
		case 'revisions':
			$label = __( 'Revisions', 'desktop-mode' );
			foreach ( wp_get_post_revisions( $id ) as $revision ) {
				$rows[] = array(
					'id'       => (int) $revision->ID,
					'title'    => (string) wp_post_revision_title_expanded( $revision, false ),
					'subtitle' => (string) get_the_author_meta( 'display_name', (int) $revision->post_author ),
					'icon'     => 'dashicons-backup',
					'editUrl'  => current_user_can( 'edit_post', $id )
						? admin_url( 'revision.php?revision=' . (int) $revision->ID )
						: '',
				);
			}
			break;
		default:
			return null;
	}

	return array(
		'label' => $label,
		'rows'  => $rows,
	);
}

/**
 * Invoke one of WP Explorer's stats REST callbacks in-process, with a
 * synthetic request — the panes render the SAME payloads WP Explorer
 * renders, filters (`openstation_my_wordpress_term_stats` and
 * friends) included.
 *
 * @param string              $callback Function name.
 * @param array<string,mixed> $params   Request params.
 * @return array<string,mixed>|null Null when unavailable or refused.
 */
function stats_payload( $callback, array $params ) {
	if ( ! function_exists( $callback ) || ! class_exists( '\WP_REST_Request' ) ) {
		return null;
	}
	$request = new \WP_REST_Request();
	foreach ( $params as $key => $value ) {
		$request->set_param( $key, $value );
	}
	$payload = call_user_func( $callback, $request );
	return is_array( $payload ) ? $payload : null;
}

/**
 * The right-pane dossier for one SELECTED sub-list row, per relation:
 * the term-stats card for a category or tag (stat tiles, 12-month
 * activity, first/last post, recent posts), the user dossier + stats
 * for author/contributors, the comment dossier, the media dossier
 * with its usage scan, a revision preview.
 *
 * @param Os                  $os       Host handle.
 * @param array<string,mixed> $section  Section descriptor.
 * @param int                 $post_id  Post navigated into.
 * @param string              $relation Relation slug.
 * @param int                 $row_id   Selected row id.
 * @return array<string,mixed>|null
 */
function sub_detail( Os $os, array $section, $post_id, $relation, $row_id ) {
	switch ( $relation ) {
		case 'categories':
		case 'tags':
			$stats = stats_payload(
				'openstation_my_wordpress_term_stats_callback',
				array(
					'taxonomy' => 'tags' === $relation ? 'post_tag' : 'category',
					'id'       => $row_id,
				)
			);
			return $stats ? array(
				'kind'  => 'term',
				'stats' => $stats,
			) : null;

		case 'author':
		case 'contributors':
			$user_section = array(
				'kind'      => 'user',
				'post_type' => '',
			);
			$dossier      = detail( $os, $user_section, $row_id );
			if ( ! $dossier ) {
				return null;
			}
			return array(
				'kind'   => 'user',
				'detail' => $dossier,
				'stats'  => stats_payload( 'openstation_my_wordpress_user_stats_callback', array( 'id' => $row_id ) ),
			);

		case 'comments':
			$stats = stats_payload( 'openstation_my_wordpress_comment_stats_callback', array( 'id' => $row_id ) );
			return $stats ? array(
				'kind'  => 'comment',
				'stats' => $stats,
			) : null;

		case 'media':
			$media_section = array(
				'kind'       => 'media',
				'post_type'  => 'attachment',
				'thumbnails' => true,
			);
			$dossier       = detail( $os, $media_section, $row_id );
			return $dossier ? array(
				'kind'   => 'media',
				'detail' => $dossier,
			) : null;

		case 'revisions':
			$revision = wp_get_post_revision( $row_id );
			if ( ! $revision || (int) $revision->post_parent !== (int) $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
				return null;
			}
			return array(
				'kind'    => 'revision',
				'title'   => (string) wp_post_revision_title_expanded( $revision, false ),
				'author'  => (string) get_the_author_meta( 'display_name', (int) $revision->post_author ),
				'date'    => (string) get_the_date( '', $revision ) . ' ' . get_the_time( '', $revision ),
				'content' => wp_kses_post( (string) apply_filters( 'the_content', (string) $revision->post_content ) ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's own content pipeline.
			);
	}
	return null;
}

/**
 * The choices the Edit… modal offers: the site's authors and the
 * category terms. Only computed while a post-kind section is open.
 *
 * @return array{authors:array[],categories:array[]}
 */
function edit_choices() {
	$authors = array();
	foreach ( get_users(
		array(
			'capability' => array( 'edit_posts' ),
			'number'     => 100,
			'orderby'    => 'display_name',
			'fields'     => array( 'ID', 'display_name' ),
		)
	) as $user ) {
		$authors[] = array(
			'id'   => (int) $user->ID,
			'name' => (string) $user->display_name,
		);
	}
	$categories = array();
	foreach ( get_terms(
		array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
			'number'     => 100,
		)
	) as $term ) {
		if ( $term instanceof \WP_Term ) {
			$categories[] = array(
				'id'   => (int) $term->term_id,
				'name' => (string) $term->name,
			);
		}
	}
	return array(
		'authors'    => $authors,
		'categories' => $categories,
	);
}

/**
 * The preview-action descriptors the acting user may see — the same
 * `openstation_my_wordpress_preview_actions` pipeline WP Explorer
 * collects, minus the fields the client does not need.
 *
 * @param Os $os Host handle.
 * @return array<int,array<string,mixed>>
 */
function preview_actions( Os $os ) {
	if ( ! function_exists( 'openstation_my_wordpress_collect_preview_actions' ) ) {
		return array();
	}
	$out = array();
	foreach ( (array) openstation_my_wordpress_collect_preview_actions() as $action ) {
		if ( ! is_array( $action ) || empty( $action['id'] ) ) {
			continue;
		}
		if ( ! empty( $action['capability'] ) && ! $os->can( (string) $action['capability'] ) ) {
			continue;
		}
		$out[] = array(
			'id'       => (string) $action['id'],
			'label'    => (string) ( $action['label'] ?? $action['id'] ),
			'icon'     => (string) ( $action['icon'] ?? '' ),
			'sections' => array_map( 'strval', (array) ( $action['sections'] ?? array() ) ),
			'mime'     => (string) ( $action['mime'] ?? '' ),
		);
	}
	return $out;
}

// ----------------------------------------------------------------- app

return App::define( 'my-wordpress' )
	->title( __( 'My WordPress', 'desktop-mode' ) )
	->icon( ICON )
	->size( 960, 640 )
	->min_size( 640, 420 )
	->placement( 'none' )
	->desktop_icon( array( 'position' => 2 ) )
	->capabilities( 'edit_posts' )
	->watch( '*' )
	->state(
		array(
			'group'    => '',
			'section'  => '',
			'item'     => 0,
			'into'     => 0,
			'relation' => '',
			'query'    => '',
			'page'     => 1,
			'sort'     => '',
			'selected' => array(),
		)
	)
	->title_bar_button(
		'refresh',
		array(
			'label'  => __( 'Refresh', 'desktop-mode' ),
			'icon'   => 'reload',
			'action' => 'refresh',
		)
	)
	// Recomputing data() IS the refresh; the handler has nothing to do.
	->action( 'refresh', static function () {} )
	->action(
		'go',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'group', isset( $args['group'] ) ? (string) $args['group'] : '' );
			$state->set( 'section', isset( $args['section'] ) ? (string) $args['section'] : '' );
			$state->set( 'item', 0 )->set( 'into', 0 )->set( 'relation', '' )
				->set( 'query', '' )->set( 'page', 1 )
				->set( 'sort', '' )->reset( 'selected' );
		}
	)
	->action(
		'back',
		static function ( State $state ) {
			if ( '' !== (string) $state->get( 'relation' ) ) {
				$state->set( 'relation', '' );
				return;
			}
			if ( (int) $state->get( 'into' ) > 0 ) {
				$state->set( 'into', 0 );
				return;
			}
			if ( (int) $state->get( 'item' ) > 0 ) {
				$state->set( 'item', 0 );
				return;
			}
			if ( '' !== (string) $state->get( 'section' ) ) {
				$state->set( 'section', '' )->set( 'query', '' )->set( 'page', 1 )
					->set( 'sort', '' )->reset( 'selected' );
				return;
			}
			$state->set( 'group', '' );
		}
	)
	->action(
		'open',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'item', (int) ( $args['item'] ?? 0 ) );
		}
	)
	->action(
		'into',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'into', (int) ( $args['item'] ?? 0 ) )
				->set( 'relation', '' )->set( 'item', 0 );
		}
	)
	->action(
		'relation',
		static function ( State $state, Os $os, array $args ) {
			$relation = (string) ( $args['relation'] ?? '' );
			$allowed  = array( 'author', 'contributors', 'comments', 'categories', 'tags', 'media', 'revisions' );
			$state->set( 'relation', in_array( $relation, $allowed, true ) ? $relation : '' )
				->set( 'item', 0 );
		}
	)
	->action(
		'sub-open-post',
		static function ( State $state, Os $os, array $args ) {
			// A recent-posts row in a stats pane → its editor.
			$id = (int) ( $args['post'] ?? 0 );
			if ( $id > 0 && $os->can( 'edit_post', $id ) ) {
				$os->open_url( admin_url( 'post.php?post=' . $id . '&action=edit' ) );
			}
		}
	)
	->action(
		'search',
		static function ( State $state ) {
			$state->set( 'page', 1 )->set( 'item', 0 )->reset( 'selected' );
		}
	)
	->action(
		'more',
		static function ( State $state ) {
			$state->set( 'page', (int) $state->get( 'page' ) + 1 );
		}
	)
	->action(
		'sort',
		static function ( State $state ) {
			// The bound `sort` value already arrived with the state;
			// re-query from the first page in the new order.
			$state->set( 'page', 1 )->reset( 'selected' );
		}
	)
	->action(
		'paginate',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'page', max( 1, (int) ( $args['page'] ?? 1 ) ) )->reset( 'selected' );
		}
	)
	->action(
		'edit',
		static function ( State $state, Os $os, array $args ) {
			$section = section_of( $os, (string) $state->get( 'section' ) );
			$id      = (int) ( $args['item'] ?? 0 );
			if ( $section && allowed( $os, $section, $id, 'edit' ) ) {
				$os->open_url( edit_url( $section, $id ) );
			}
		}
	)
	->action(
		'trash',
		static function ( State $state, Os $os, array $args ) {
			$section = section_of( $os, (string) $state->get( 'section' ) );
			$id      = (int) ( $args['item'] ?? 0 );
			if ( ! $section || 'post' !== $section['kind'] || ! allowed( $os, $section, $id, 'delete' ) ) {
				$os->toast( __( 'You cannot trash this item.', 'desktop-mode' ) );
				return;
			}
			if ( ! wp_trash_post( $id ) ) {
				$os->toast( __( 'Trashing failed.', 'desktop-mode' ) );
				return;
			}
			if ( $id === (int) $state->get( 'item' ) ) {
				$state->set( 'item', 0 );
			}
			if ( $state->contains( 'selected', $id ) ) {
				$state->toggle_item( 'selected', $id );
			}
			$os->toast( __( 'Moved to the Trash.', 'desktop-mode' ) );
			$os->announce( (string) $section['post_type'], 'trashed', $id );
		}
	)
	->action(
		'sub-open',
		static function ( State $state, Os $os, array $args ) {
			$section = section_of( $os, (string) $state->get( 'section' ) );
			$into    = (int) $state->get( 'into' );
			$rel     = (string) $state->get( 'relation' );
			if ( ! $section || $into <= 0 || '' === $rel ) {
				return;
			}
			// The URL is recomputed here from the row id — never taken
			// from the client — so it carries the same capability gates
			// the sub-list applied.
			$payload = sub( $os, $section, $into, $rel );
			$wanted  = (int) ( $args['row'] ?? 0 );
			foreach ( (array) ( $payload['rows'] ?? array() ) as $row ) {
				if ( $wanted === (int) $row['id'] && '' !== $row['editUrl'] ) {
					$os->open_url( (string) $row['editUrl'], (string) $row['title'] );
					return;
				}
			}
		}
	)
	->action(
		'quick-edit',
		static function ( State $state, Os $os, array $args ) {
			$section = section_of( $os, (string) $state->get( 'section' ) );
			if ( ! $section || 'post' !== $section['kind'] ) {
				return;
			}
			$status   = isset( $args['status'] ) ? (string) $args['status'] : '';
			$comments = isset( $args['comments'] ) ? (string) $args['comments'] : '';
			$author   = (int) ( $args['author'] ?? 0 );
			$sticky   = isset( $args['sticky'] ) ? (string) $args['sticky'] : '';
			$add_cats = array_filter( array_map( 'intval', (array) ( $args['categories'] ?? array() ) ) );
			$add_tags = array_filter( array_map( 'trim', explode( ',', (string) ( $args['tags'] ?? '' ) ) ) );
			if ( ! in_array( $status, array( '', 'publish', 'pending', 'draft', 'private' ), true )
				|| ! in_array( $comments, array( '', 'open', 'closed' ), true )
				|| ! in_array( $sticky, array( '', 'sticky', 'not-sticky' ), true ) ) {
				return;
			}
			if ( '' === $status && '' === $comments && 0 === $author && '' === $sticky
				&& array() === $add_cats && array() === $add_tags ) {
				return;
			}
			$updated = array();
			foreach ( array_map( 'intval', (array) ( $args['items'] ?? array() ) ) as $id ) {
				$post = $id > 0 ? get_post( $id ) : null;
				if ( ! $post || $post->post_type !== $section['post_type'] || ! allowed( $os, $section, $id, 'edit' ) ) {
					continue;
				}
				if ( 'publish' === $status && ! $os->can( 'publish_post', $id ) ) {
					continue;
				}
				if ( $author > 0 && ! $os->can( 'edit_others_posts' ) ) {
					continue;
				}
				$fields = array( 'ID' => $id );
				if ( '' !== $status ) {
					$fields['post_status'] = $status;
				}
				if ( '' !== $comments ) {
					$fields['comment_status'] = $comments;
				}
				if ( $author > 0 && false !== get_userdata( $author ) ) {
					$fields['post_author'] = $author;
				}
				if ( ! wp_update_post( $fields ) ) {
					continue;
				}
				if ( 'post' === $post->post_type ) {
					if ( 'sticky' === $sticky ) {
						stick_post( $id );
					} elseif ( 'not-sticky' === $sticky ) {
						unstick_post( $id );
					}
					if ( array() !== $add_cats && is_object_in_taxonomy( $post->post_type, 'category' ) ) {
						wp_set_post_categories( $id, $add_cats, true );
					}
					if ( array() !== $add_tags && is_object_in_taxonomy( $post->post_type, 'post_tag' ) ) {
						wp_set_post_terms( $id, $add_tags, 'post_tag', true );
					}
				}
				$updated[] = $id;
			}
			if ( array() === $updated ) {
				$os->toast( __( 'Nothing could be updated.', 'desktop-mode' ) );
				return;
			}
			$os->toast(
				sprintf(
					/* translators: %s: updated count. */
					_n( '%s entry updated.', '%s entries updated.', count( $updated ), 'desktop-mode' ),
					number_format_i18n( count( $updated ) )
				)
			);
			$os->announce( (string) $section['post_type'], 'updated', $updated );
		}
	)
	->action(
		'bulk-trash',
		static function ( State $state, Os $os ) {
			$section = section_of( $os, (string) $state->get( 'section' ) );
			if ( ! $section || 'post' !== $section['kind'] ) {
				return;
			}
			$trashed = array();
			foreach ( array_map( 'intval', (array) $state->get( 'selected' ) ) as $id ) {
				if ( $id > 0 && allowed( $os, $section, $id, 'delete' ) && wp_trash_post( $id ) ) {
					$trashed[] = $id;
				}
			}
			$state->reset( 'selected' );
			if ( in_array( (int) $state->get( 'item' ), $trashed, true ) ) {
				$state->set( 'item', 0 );
			}
			if ( array() === $trashed ) {
				$os->toast( __( 'Nothing could be trashed.', 'desktop-mode' ) );
				return;
			}
			$os->toast(
				sprintf(
					/* translators: %s: trashed count. */
					_n( 'Moved %s item to the Trash.', 'Moved %s items to the Trash.', count( $trashed ), 'desktop-mode' ),
					number_format_i18n( count( $trashed ) )
				)
			);
			$os->announce( (string) $section['post_type'], 'trashed', $trashed );
		}
	)
	->data(
		static function ( State $state, Os $os ) {
			$sections = sections( $os );
			$section  = section_of( $os, (string) $state->get( 'section' ) );
			if ( ! $section && '' !== (string) $state->get( 'section' ) ) {
				// A section that vanished (deactivated plugin, lost cap):
				// fall back to the root rather than a dead end.
				$state->set( 'section', '' )->set( 'item', 0 );
			}
			$group_list = groups( $sections );
			$group_ids  = array_column( $group_list, 'id' );
			if ( '' !== (string) $state->get( 'group' ) && ! in_array( (string) $state->get( 'group' ), $group_ids, true ) ) {
				$state->set( 'group', '' );
			}

			$with_counts = array();
			foreach ( $sections as $entry ) {
				$entry['count'] = count_of( $entry );
				unset( $entry['capability'] );
				$with_counts[] = $entry;
			}

			$item = (int) $state->get( 'item' );
			$into = (int) $state->get( 'into' );
			if ( $into > 0 && ( ! $section || 'post' !== $section['kind'] ) ) {
				$state->set( 'into', 0 )->set( 'relation', '' );
				$into = 0;
			}
			$relation = (string) $state->get( 'relation' );
			$is_post  = $section && 'post' === $section['kind'];
			$choices  = $is_post ? edit_choices() : array(
				'authors'    => array(),
				'categories' => array(),
			);
			return array(
				'siteName'       => (string) get_bloginfo( 'name' ),
				'sections'       => $with_counts,
				'groups'         => $group_list,
				'sortOptions'    => $section
					? array_map(
						static function ( $row ) {
							return $row[0];
						},
						sort_options( $section )
					)
					: (object) array(),
				'list'           => $section && 0 === $into ? fetch( $os, $section, $state ) : null,
				'detail'         => $section && 0 === $into && $item > 0 ? detail( $os, $section, $item ) : null,
				'folder'         => $section && $into > 0 ? folder( $os, $section, $into ) : null,
				'sub'            => $section && $into > 0 && '' !== $relation ? sub( $os, $section, $into, $relation ) : null,
				'subDetail'      => $section && $into > 0 && '' !== $relation && $item > 0
					? sub_detail( $os, $section, $into, $relation, $item )
					: null,
				'authors'        => $choices['authors'],
				'categories'     => $choices['categories'],
				'previewActions' => preview_actions( $os ),
			);
		}
	);
