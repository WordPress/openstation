<?php
/**
 * Desktop window content relations — server-side surface.
 *
 * A desktop window may carry a "content identity": the object the
 * page inside it shows ("post 123", "comment 45 of post 123"). The
 * shell groups windows sharing the same root object and draws visual
 * ties between them (see `src/window-links/` and
 * `docs/examples/window-links.md`).
 *
 * This file builds the authoritative identity for admin iframe pages.
 * It runs inside the chromeless iframe request — real admin context,
 * where `get_current_screen()` and the content globals are live — so
 * relations the URL alone can't answer (which post a comment belongs
 * to) resolve server-side and reach the shell via the chromeless
 * bridge's `desktop-mode-content-identity` postMessage.
 *
 * @since 0.9.4
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build the content identity for the current admin screen.
 *
 * Returns `null` when the screen shows no single identifiable object
 * (list tables, dashboards, settings pages, `post-new.php` before the
 * first save). Shape mirrors the JS `WindowContentRef`:
 *
 *     array(
 *         'type'  => 'comment',                          // sanitize_key'd object type
 *         'id'    => 45,
 *         'label' => 'Nice post! I especially liked…',   // optional, for tooltips
 *         'root'  => array( 'type' => 'post', 'id' => 123 ), // omitted when this IS a root
 *     )
 *
 * Detected screens:
 *  - `post.php` (post / page / CPT edit) — a root identity.
 *  - `post.php` on an attachment (Media edit) — `media`, rooted at
 *    `post_parent` when attached.
 *  - `comment.php` (comment edit / moderation) — `comment`, rooted at
 *    the parent post. The URL alone can't answer this one; only real
 *    admin context can.
 *
 * @since 0.9.4
 *
 * @return array|null Identity array, or `null` when none applies.
 */
function desktop_mode_build_content_identity() {
	$identity = null;
	$screen   = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	$pagenow  = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';

	if ( 'comment.php' === $pagenow ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
		$comment_id = isset( $_GET['c'] ) ? absint( $_GET['c'] ) : 0;
		$comment    = $comment_id ? get_comment( $comment_id ) : null;
		if ( $comment ) {
			$identity = array(
				'type'  => 'comment',
				'id'    => (int) $comment->comment_ID,
				'label' => wp_trim_words( $comment->comment_content, 10 ),
			);

			$post_id   = (int) $comment->comment_post_ID;
			$post_type = $post_id ? get_post_type( $post_id ) : false;
			if ( $post_type ) {
				$identity['root'] = array(
					'type' => sanitize_key( $post_type ),
					'id'   => $post_id,
				);
			}
		}
	} elseif ( $screen && 'post' === $screen->base && 'add' !== $screen->action ) {
		$post = get_post();
		if ( $post instanceof WP_Post && $post->ID > 0 ) {
			if ( 'attachment' === $post->post_type ) {
				$identity = array(
					'type'  => 'media',
					'id'    => (int) $post->ID,
					'label' => get_the_title( $post ),
				);

				$parent_id   = (int) $post->post_parent;
				$parent_type = $parent_id ? get_post_type( $parent_id ) : false;
				if ( $parent_type ) {
					$identity['root'] = array(
						'type' => sanitize_key( $parent_type ),
						'id'   => $parent_id,
					);
				}
			} else {
				$identity = array(
					'type'  => sanitize_key( $post->post_type ),
					'id'    => (int) $post->ID,
					'label' => get_the_title( $post ),
				);

				// Outbound references — internal hyperlinks, embedded
				// media, and assigned terms. When a window showing a
				// referenced object is open, the shell draws a directed
				// tie toward it (mutual links collapse into one
				// bidirectional arrow).
				$links = desktop_mode_window_links_extract_references( $post );
				if ( ! empty( $links ) ) {
					$identity['links'] = $links;
				}

				// Source for the built-in related-entity items attached
				// after the identity filter below.
				$related_source_post = $post;
			}
		}
	} elseif ( 'upload.php' === $pagenow ) {
		// Media Library grid with a details modal open —
		// `upload.php?item=N`. The classic attachment-edit screen
		// (`post.php` on an attachment) is handled above; this covers
		// the far more common grid path. Only the item present at page
		// load is announced — the modal navigates client-side without
		// reloading, which is fine for the primary "open this media"
		// flow the shell produces.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
		$item_id = isset( $_GET['item'] ) ? absint( $_GET['item'] ) : 0;
		$item    = $item_id ? get_post( $item_id ) : null;
		if ( $item instanceof WP_Post && 'attachment' === $item->post_type ) {
			$identity = array(
				'type'  => 'media',
				'id'    => (int) $item->ID,
				'label' => get_the_title( $item ),
			);

			$parent_id   = (int) $item->post_parent;
			$parent_type = $parent_id ? get_post_type( $parent_id ) : false;
			if ( $parent_type ) {
				$identity['root'] = array(
					'type' => sanitize_key( $parent_type ),
					'id'   => $parent_id,
				);
			}
		}
	} elseif ( 'edit-comments.php' === $pagenow ) {
		// Comments list filtered to a single post —
		// `edit-comments.php?p=N`, the target the Related menu's
		// "Comments" item opens. One identity per post, rooted at the
		// post, so the comments window and its post window tie
		// together on the desktop. The unfiltered ALL-comments list
		// stays identity-less.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
		$post_id = isset( $_GET['p'] ) ? absint( $_GET['p'] ) : 0;
		$post    = $post_id ? get_post( $post_id ) : null;
		if ( $post instanceof WP_Post && 'attachment' !== $post->post_type ) {
			$identity = array(
				'type'  => 'comments',
				'id'    => (int) $post->ID,
				/* translators: %s: post title. */
				'label' => sprintf( __( 'Comments on %s', 'desktop-mode' ), get_the_title( $post ) ),
				'root'  => array(
					'type' => sanitize_key( $post->post_type ),
					'id'   => (int) $post->ID,
				),
			);
		}
	} elseif ( 'term.php' === $pagenow ) {
		// Term edit screen — `term.php?taxonomy=category&tag_ID=N`.
		// A term is its own root (`term/{taxonomy}`); posts assigned to
		// it reference it through their identity's `links`, so an open
		// post window and its category/tag window tie together.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
		$term_id = isset( $_GET['tag_ID'] ) ? absint( $_GET['tag_ID'] ) : 0;
		$term    = $term_id ? get_term( $term_id ) : null;
		if ( $term instanceof WP_Term ) {
			$identity = array(
				'type'  => 'term/' . sanitize_key( $term->taxonomy ),
				'id'    => (int) $term->term_id,
				'label' => $term->name,
			);
		}
	}

	/**
	 * Filters the content identity announced for the current admin screen.
	 *
	 * Plugins add identities for their own admin screens (an order
	 * editor, a form-entry viewer) or return `null` to suppress the
	 * built-in detection. The shape must match the JS
	 * `WindowContentRef`: `type` (lowercase slug), `id` (int|string),
	 * optional `label`, optional `root => array( 'type', 'id' )`.
	 *
	 * @since 0.9.4
	 *
	 * @param array|null     $identity Identity array, or `null` for none.
	 * @param WP_Screen|null $screen   The current screen, when available.
	 */
	$identity = apply_filters( 'desktop_mode_window_content_identity', $identity, $screen );

	// Related-entity navigation targets — what the title bar's
	// "Related" button lists. Runs AFTER the identity filter so
	// plugin-injected identities for custom screens get the related
	// filter too, and only for a resolved identity: no identity, no
	// related menu.
	return desktop_mode_window_related_attach(
		$identity,
		isset( $related_source_post ) && $related_source_post instanceof WP_Post ? $related_source_post : null,
		$screen
	);
}

/**
 * The related-entity pass: attach the `related` navigation items to a
 * (post-identity-filter) content identity. Shared by the page-render
 * builder above and the REST recompute endpoint the editor
 * save-watcher hits (where `$screen` is `null`).
 *
 * @since 0.9.6
 * @internal
 *
 * @param array|null     $identity Filtered identity, or `null`.
 * @param WP_Post|null   $post     The detected source post, when the
 *                                 screen showed one.
 * @param WP_Screen|null $screen   The current screen, when available.
 * @return array|null The identity with `related` attached (or the
 *                    input untouched when it was `null`).
 */
function desktop_mode_window_related_attach( $identity, $post, $screen ) {
	if ( ! is_array( $identity ) ) {
		return $identity;
	}

	$related = array();
	if (
		$post instanceof WP_Post &&
		// Built-ins belong to THIS post. If the identity filter
		// rewrote the identity to a different object (a gated post
		// remapped to a minimal ref, a custom root scheme), the
		// post's comments/terms/media must not tag along — that
		// would leak labels and deep links the filter deliberately
		// removed.
		isset( $identity['type'], $identity['id'] ) &&
		sanitize_key( $post->post_type ) === $identity['type'] &&
		(int) $post->ID === (int) $identity['id']
	) {
		$related = desktop_mode_window_related_entities_for_post( $post );
	}
	if ( isset( $identity['related'] ) && is_array( $identity['related'] ) ) {
		// An identity filter may ship related items with its own
		// identity — fold them in so they reach the related filter
		// (and the sanitizer) like everything else.
		$related = array_merge( $related, $identity['related'] );
	}

	/**
	 * Filters the related-entity navigation items announced with the
	 * current screen's content identity.
	 *
	 * Each item becomes an entry in the window's title-bar "Related"
	 * menu; clicking it opens the target admin URL as its own
	 * desktop window. Built-ins cover posts and pages (comments,
	 * assigned terms, associated media, linked posts); plugins add
	 * items for their own screens or object types here. Item shape
	 * (mirrors the JS `RelatedEntityItem`):
	 *
	 *     array(
	 *         'id'         => 'comments',            // unique in the list
	 *         'group'      => 'comments',            // section key; built-ins:
	 *                                                // 'comments', 'terms/{tax}',
	 *                                                // 'media', 'links'
	 *         'groupLabel' => __( 'Comments' ),      // optional section header
	 *         'label'      => __( 'Comments' ),
	 *         'icon'       => 'dashicons-admin-comments', // optional
	 *         'url'        => admin_url( 'edit-comments.php?p=123' ),
	 *         'count'      => 4,                     // optional badge
	 *     )
	 *
	 * Malformed entries (missing/empty `id`, `group`, `label`, or
	 * `url`) are dropped before the payload is announced.
	 *
	 * Runs during the chromeless page render AND on the
	 * `desktop-mode/v1/content-identity` REST recompute the editor
	 * save-watcher triggers — in the REST context `$screen` is `null`.
	 *
	 * @since 0.9.6
	 *
	 * @param array[]        $related  Related-entity items.
	 * @param array          $identity The resolved content identity.
	 * @param WP_Screen|null $screen   The current screen, when available.
	 */
	$related = apply_filters( 'desktop_mode_window_related_entities', $related, $identity, $screen );
	$related = desktop_mode_window_related_entities_sanitize( $related );
	// The related pass is the single authority over the key — an
	// identity filter smuggling its own `related` would bypass the
	// sanitizer above.
	unset( $identity['related'] );
	if ( ! empty( $related ) ) {
		$identity['related'] = $related;
	}

	return $identity;
}

/**
 * Resolve a post's outbound references for the identity's `links`
 * array — everything this post's window should tie to when a window
 * showing it is open:
 *
 *  1. Internal hyperlinks in `post_content` that resolve to another
 *     post (via the content-graph extractor). Attachment pages and
 *     self-links are skipped.
 *  2. Media EMBEDDED in the content, harvested from the
 *     `wp-image-{id}` class both the block and classic editors stamp
 *     on inserted images. Deliberate: inserting an existing library
 *     image does NOT set `post_parent` (only uploading while editing
 *     attaches), so parent-based linking alone misses most in-content
 *     media.
 *  3. Assigned terms of every public taxonomy, as `term/{taxonomy}`
 *     refs — ties the post to open category/tag windows.
 *
 * Deduped by type:id and capped so a link-farm post can't flood the
 * shell.
 *
 * @since 0.9.4
 *
 * @param WP_Post $post Source post.
 * @return array[] Reference entries, possibly empty.
 */
function desktop_mode_window_links_extract_references( $post ) {
	$links = array();
	$seen  = array();
	$push  = static function ( $type, $id, $rel = '' ) use ( &$links, &$seen ) {
		$key = $type . ':' . $id;
		if ( isset( $seen[ $key ] ) || count( $links ) >= 64 ) {
			return;
		}
		$seen[ $key ] = true;
		$entry        = array(
			'type' => $type,
			'id'   => (int) $id,
		);
		if ( 'child' === $rel ) {
			// Arrow semantics: `child` reverses the tie — the linked
			// object BELONGS TO this post (arrow media → post), unlike
			// the default `references` (arrow post → target).
			$entry['rel'] = 'child';
		}
		$links[] = $entry;
	};

	// 1. Internal hyperlinks → posts. Guarded: the content-graph
	// extractor lives in a separate include.
	if ( function_exists( 'desktop_mode_content_graph_extract_internal_links' ) ) {
		$ids = desktop_mode_content_graph_extract_internal_links( (string) $post->post_content );
		foreach ( array_slice( $ids, 0, 32 ) as $target_id ) {
			$target_id = (int) $target_id;
			if ( $target_id === (int) $post->ID ) {
				continue;
			}
			$target_type = get_post_type( $target_id );
			if ( ! $target_type || 'attachment' === $target_type ) {
				continue;
			}
			$push( sanitize_key( $target_type ), $target_id );
		}
	}

	// 2. Embedded media — `wp-image-{id}` classes — plus the featured
	// image, which never appears in `post_content` at all. Declared as
	// `child` refs: the image BELONGS TO the post, so the arrow runs
	// media → post, matching attached media (`post_parent` roots) —
	// the same visible relationship must never flip direction over an
	// invisible technicality like attachment state.
	if ( preg_match_all( '/\bwp-image-(\d+)\b/', (string) $post->post_content, $matches ) ) {
		foreach ( array_slice( array_unique( $matches[1] ), 0, 32 ) as $media_id ) {
			$media_id = (int) $media_id;
			if ( $media_id > 0 && 'attachment' === get_post_type( $media_id ) ) {
				$push( 'media', $media_id, 'child' );
			}
		}
	}
	$thumbnail_id = (int) get_post_thumbnail_id( $post );
	if ( $thumbnail_id > 0 && 'attachment' === get_post_type( $thumbnail_id ) ) {
		$push( 'media', $thumbnail_id, 'child' );
	}

	// 3. Assigned terms of public taxonomies.
	foreach ( get_object_taxonomies( $post, 'objects' ) as $taxonomy ) {
		if ( empty( $taxonomy->public ) ) {
			continue;
		}
		$terms = get_the_terms( $post, $taxonomy->name );
		if ( ! is_array( $terms ) ) {
			continue;
		}
		foreach ( array_slice( $terms, 0, 32 ) as $term ) {
			$push( 'term/' . sanitize_key( $taxonomy->name ), (int) $term->term_id );
		}
	}

	return $links;
}

/**
 * Build the built-in related-entity navigation items for a post or
 * page — the entries the window's title-bar "Related" menu offers:
 *
 *  1. **Comments** — one item opening the Comments screen filtered to
 *     this post (`edit-comments.php?p={id}`), with the comment total
 *     as a count badge. Only when the post type supports comments AND
 *     at least one exists — an empty filtered list is a dead end.
 *  2. **Assigned terms** — one item per term of every public
 *     taxonomy, opening that term's edit screen
 *     (`term.php?taxonomy={tax}&tag_ID={id}`), grouped per taxonomy.
 *  3. **Media** — one item per associated attachment (featured image,
 *     `post_parent`-attached uploads, and `wp-image-{id}` embeds —
 *     the same three sources the reference extractor uses), opening
 *     the Media Library grid with that item's details modal
 *     (`upload.php?item={id}`). Core has no parent-filtered library
 *     view, so per-item deep links are the honest navigation.
 *  4. **Linked posts** — one item per internal hyperlink in the
 *     content that resolves to another post on this site (same
 *     extractor the window ties use), opening that post's editor.
 *     Cross-site and external hrefs don't resolve to a post id and
 *     are excluded.
 *
 * Built-ins deliberately cover `post` and `page` only; other post
 * types (and non-post screens) join via the
 * `desktop_mode_window_related_entities` filter.
 *
 * @since 0.9.6
 *
 * @param WP_Post $post Source post.
 * @return array[] Related-entity items, possibly empty.
 */
function desktop_mode_window_related_entities_for_post( $post ) {
	if ( ! $post instanceof WP_Post || ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) {
		return array();
	}

	$related = array();

	// 1. Comments. Count approved + awaiting moderation — the filtered
	// screen the item opens lists both, and the moderation queue is
	// the flow this jump serves most. `get_comments_number()` would
	// return the approved-only cached count, hiding the item exactly
	// when every comment is pending and disagreeing with the opened
	// list when counts are mixed.
	$comment_totals = get_comment_count( $post->ID );
	$comment_count  = isset( $comment_totals['total_comments'] ) ? (int) $comment_totals['total_comments'] : 0;
	if ( post_type_supports( $post->post_type, 'comments' ) && $comment_count > 0 ) {
		$related[] = array(
			'id'         => 'comments',
			'group'      => 'comments',
			'groupLabel' => __( 'Comments', 'desktop-mode' ),
			'label'      => __( 'Comments', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-comments',
			'url'        => admin_url( 'edit-comments.php?p=' . $post->ID ),
			'count'      => $comment_count,
		);
	}

	// 2. Assigned terms of public taxonomies. Budgeted at 32 items
	// ACROSS taxonomies (not per taxonomy): the engine hard-caps the
	// whole `related` list at 64, and an unbudgeted term flood would
	// silently push the trailing groups past that cap. Worst case is
	// 1 comments + 32 terms + 20 media + 10 links = 63 — built-ins
	// can never hit the engine's truncation.
	$term_budget = 32;
	foreach ( get_object_taxonomies( $post, 'objects' ) as $taxonomy ) {
		if ( empty( $taxonomy->public ) || $term_budget <= 0 ) {
			continue;
		}
		$terms = get_the_terms( $post, $taxonomy->name );
		if ( ! is_array( $terms ) ) {
			continue;
		}
		foreach ( array_slice( $terms, 0, $term_budget ) as $term ) {
			--$term_budget;
			$tax_slug  = sanitize_key( $taxonomy->name );
			$related[] = array(
				'id'         => 'term-' . $tax_slug . '-' . (int) $term->term_id,
				'group'      => 'terms/' . $tax_slug,
				'groupLabel' => (string) $taxonomy->labels->name,
				'label'      => $term->name,
				'icon'       => ! empty( $taxonomy->hierarchical ) ? 'dashicons-category' : 'dashicons-tag',
				'url'        => admin_url( 'term.php?taxonomy=' . rawurlencode( $taxonomy->name ) . '&tag_ID=' . (int) $term->term_id ),
			);
		}
	}

	// 3. Associated media — featured image first, then attached
	// uploads, then in-content embeds. Deduped and capped so a
	// gallery-heavy post can't turn the menu into a scroll marathon.
	$media_ids = array();
	$push_id   = static function ( $media_id ) use ( &$media_ids ) {
		$media_id = (int) $media_id;
		if ( $media_id > 0 && ! in_array( $media_id, $media_ids, true ) && 'attachment' === get_post_type( $media_id ) ) {
			$media_ids[] = $media_id;
		}
	};

	$push_id( get_post_thumbnail_id( $post ) );
	$attached = get_children(
		array(
			'post_parent'    => $post->ID,
			'post_type'      => 'attachment',
			'posts_per_page' => 20,
			'orderby'        => 'menu_order ID',
			'order'          => 'ASC',
			'fields'         => 'ids',
		)
	);
	foreach ( $attached as $media_id ) {
		$push_id( $media_id );
	}
	if ( preg_match_all( '/\bwp-image-(\d+)\b/', (string) $post->post_content, $matches ) ) {
		foreach ( array_unique( $matches[1] ) as $media_id ) {
			$push_id( $media_id );
		}
	}

	foreach ( array_slice( $media_ids, 0, 20 ) as $media_id ) {
		$label = get_the_title( $media_id );
		if ( '' === $label ) {
			$label = wp_basename( (string) get_attached_file( $media_id ) );
		}
		if ( '' === $label ) {
			/* translators: %d: attachment ID. */
			$label = sprintf( __( 'Media item %d', 'desktop-mode' ), $media_id );
		}
		$related[] = array(
			'id'         => 'media-' . $media_id,
			'group'      => 'media',
			'groupLabel' => __( 'Media', 'desktop-mode' ),
			'label'      => $label,
			'icon'       => 'dashicons-admin-media',
			'url'        => admin_url( 'upload.php?item=' . $media_id ),
		);
	}

	// 4. Linked posts — internal hyperlinks resolving to another post
	// on this site. Guarded: the extractor lives in the content-graph
	// include. Capped tighter than the reference extractor (10) to
	// stay inside the overall 64-item engine budget.
	if ( function_exists( 'desktop_mode_content_graph_extract_internal_links' ) ) {
		$link_ids = desktop_mode_content_graph_extract_internal_links( (string) $post->post_content );
		$count    = 0;
		foreach ( $link_ids as $target_id ) {
			if ( $count >= 10 ) {
				break;
			}
			$target_id = (int) $target_id;
			if ( $target_id === (int) $post->ID ) {
				continue;
			}
			$target_type = get_post_type( $target_id );
			if ( ! $target_type || 'attachment' === $target_type ) {
				continue;
			}
			$label = get_the_title( $target_id );
			if ( '' === $label ) {
				/* translators: %d: post ID. */
				$label = sprintf( __( 'Post %d', 'desktop-mode' ), $target_id );
			}
			$related[] = array(
				'id'         => 'link-' . $target_id,
				'group'      => 'links',
				'groupLabel' => __( 'Linked posts', 'desktop-mode' ),
				'label'      => $label,
				'icon'       => 'dashicons-admin-links',
				'url'        => admin_url( 'post.php?post=' . $target_id . '&action=edit' ),
			);
			++$count;
		}
	}

	return $related;
}

/**
 * Drop malformed related-entity items and whitelist their fields.
 *
 * Runs on the `desktop_mode_window_related_entities` filter output
 * before the payload is announced: a plugin returning one bad entry
 * must not invalidate the whole identity client-side (the JS engine
 * validates the ref as a unit and would discard everything).
 *
 * @since 0.9.6
 * @internal
 *
 * @param mixed $related Filter output.
 * @return array[] Well-formed items, reindexed.
 */
function desktop_mode_window_related_entities_sanitize( $related ) {
	if ( ! is_array( $related ) ) {
		return array();
	}

	$out = array();
	foreach ( $related as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}
		foreach ( array( 'id', 'group', 'label', 'url' ) as $required ) {
			// Mirror the JS engine's validation exactly (`.trim() !== ''`):
			// a whitespace-only value passing here would fail validateRef
			// client-side, which rejects the ref AS A UNIT — one bad item
			// would silently cost the window its whole identity. Not
			// `empty()`: that would also drop the legitimate string '0'.
			if ( ! isset( $item[ $required ] ) || ! is_string( $item[ $required ] ) || '' === trim( $item[ $required ] ) ) {
				continue 2;
			}
		}
		$entry = array(
			'id'    => $item['id'],
			'group' => $item['group'],
			'label' => $item['label'],
			'url'   => $item['url'],
		);
		if ( isset( $item['groupLabel'] ) && is_string( $item['groupLabel'] ) && '' !== trim( $item['groupLabel'] ) ) {
			$entry['groupLabel'] = $item['groupLabel'];
		}
		if ( isset( $item['icon'] ) && is_string( $item['icon'] ) && '' !== trim( $item['icon'] ) ) {
			$entry['icon'] = $item['icon'];
		}
		if ( isset( $item['count'] ) && is_numeric( $item['count'] ) ) {
			$entry['count'] = (int) $item['count'];
		}
		$out[] = $entry;
	}

	return $out;
}

/**
 * REST route: `GET /desktop-mode/v1/content-identity?post=N`.
 *
 * Recomputes a post's content identity — label, outbound `links`
 * references, and the `related` navigation items — outside a page
 * render. The chromeless bridge's editor save-watcher hits this
 * after every non-autosave Gutenberg save (Gutenberg saves over REST
 * without reloading, so the page-render announcement alone would go
 * stale the moment the user adds a category or an image) and
 * re-announces the fresh identity to the parent shell.
 *
 * Both public filters (`desktop_mode_window_content_identity`,
 * `desktop_mode_window_related_entities`) run here exactly as they
 * do at page render, with `$screen = null` — there is no WP_Screen
 * in REST context.
 *
 * @since 0.9.6
 */
function desktop_mode_register_content_identity_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/content-identity',
		array(
			'methods'             => 'GET',
			'callback'            => 'desktop_mode_rest_content_identity',
			'permission_callback' => 'desktop_mode_rest_content_identity_permission',
			'args'                => array(
				'post' => array(
					'description' => __( 'Post ID to recompute the content identity for.', 'desktop-mode' ),
					'type'        => 'integer',
					'required'    => true,
					'minimum'     => 1,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_content_identity_route' );

/**
 * Permission: desktop mode enabled AND the caller can edit the post —
 * the identity carries the post title, term names, and media labels,
 * which is exactly what the edit screen itself exposes.
 *
 * @since 0.9.6
 *
 * @param WP_REST_Request $request REST request.
 * @return true|WP_Error
 */
function desktop_mode_rest_content_identity_permission( $request ) {
	$enabled = desktop_mode_rest_require_enabled();
	if ( true !== $enabled ) {
		return $enabled;
	}
	if ( ! current_user_can( 'edit_post', (int) $request['post'] ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to edit this post.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * REST handler — rebuild the post-editor identity the same way the
 * page-render builder's `post.php` branch does, filters included.
 *
 * @since 0.9.6
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_rest_content_identity( $request ) {
	$post = get_post( (int) $request['post'] );
	if ( ! $post instanceof WP_Post || 'attachment' === $post->post_type ) {
		return new WP_Error(
			'desktop_mode_no_identity',
			__( 'No content identity for this object.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$identity = array(
		'type'  => sanitize_key( $post->post_type ),
		'id'    => (int) $post->ID,
		'label' => get_the_title( $post ),
	);
	$links    = desktop_mode_window_links_extract_references( $post );
	if ( ! empty( $links ) ) {
		$identity['links'] = $links;
	}

	/** This filter is documented in includes/window-links.php */
	$identity = apply_filters( 'desktop_mode_window_content_identity', $identity, null );
	$identity = desktop_mode_window_related_attach( $identity, $post, null );

	return rest_ensure_response( array( 'identity' => $identity ) );
}

/**
 * Declare a WP-registered script handle as a window-link renderer
 * provider.
 *
 * Mirrors the unfocus-effect / command script registration pattern:
 * minimum-ceremony PHP opt-in tells the shell which enqueued scripts
 * contribute window-link renderers. The shell injects the script URL
 * into the live-refresh payload so a plugin activated mid-session
 * surfaces its renderer in OS Settings → Effects → Window links
 * immediately, no F5 needed.
 *
 * Renderers themselves are declared JS-side via
 * `wp.desktop.registerWindowLinkRenderer( … )` — the mount callback
 * and label live in the plugin's JavaScript. The built-in
 * `svg-splines` is registered through the very same JS hook (see
 * `src/window-links/renderers/svg-splines.ts`).
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-link-renderer',
 *         plugins_url( 'js/link-renderer.js', __FILE__ ),
 *         array( 'desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-link-renderer' );
 * } );
 * desktop_mode_register_window_link_renderer_script( 'my-plugin-link-renderer' );
 * ```
 *
 * For live unregistration on deactivation, the plugin's JS should set
 * `owner: 'my-plugin-link-renderer'` on each
 * `registerWindowLinkRenderer` call. Otherwise the renderer stays
 * until the next page reload — graceful backwards-compat.
 *
 * @since 0.9.4
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function desktop_mode_register_window_link_renderer_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_handle',
			__( 'Window-link renderer script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	desktop_mode_window_link_renderer_script_registry( $handle, true );

	/**
	 * Fires after a window-link renderer script handle is registered.
	 *
	 * @since 0.9.4
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'desktop_mode_window_link_renderer_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for window-link renderer script handles.
 *
 * @since 0.9.4
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function desktop_mode_window_link_renderer_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

/**
 * Test-only: clear the registry between PHPUnit cases. See
 * {@see desktop_mode_flush_script_handle_registries()}.
 *
 * @since 0.9.4
 */
function desktop_mode_flush_window_link_renderer_script_registry() {
	desktop_mode_window_link_renderer_script_registry( '__flush__' );
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @since 0.9.4
 *
 * @return array[] List of `{ handle, scriptUrl, … }` entries.
 */
function desktop_mode_build_window_link_renderer_scripts_payload() {
	$registry = desktop_mode_window_link_renderer_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = desktop_mode_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			// Loud diagnostic — visible under WP_DEBUG. Deduped by
			// `desktop_mode_warn_unresolvable_script_handle` so the
			// notice fires once per handle per request.
			desktop_mode_warn_unresolvable_script_handle(
				'desktop_mode_register_window_link_renderer_script',
				'Window-link renderer',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
		$seen[ $handle ] = true;
	}
	return $out;
}
