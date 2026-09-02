<?php
/**
 * Station Home — the snapshot model.
 *
 * What the window paints, as plain data: the current user's recent
 * work, the four site instruments, the attention queue, the
 * capability-aware quick actions and the enabled plugin cards. Every
 * reader is bounded — one query per number, WordPress's cached update
 * totals, never a network request — and every string is escaped by
 * the view, not here. Nothing in this file knows about the window.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\StationHome;

use OpenStation\App\Os;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Post types that the current user can edit and that belong in
 * recent work.
 *
 * @param Os $os Host handle.
 * @return string[]
 */
function editable_post_types( Os $os ) {
	$types = array();
	foreach ( get_post_types( array( 'show_ui' => true ), 'objects' ) as $type ) {
		if ( ! is_object( $type ) || 'attachment' === $type->name ) {
			continue;
		}
		// Core's internal editor records (`wp_navigation`, `wp_block`,
		// templates, styles) are implementation details rather than work
		// a person expects to resume from a home screen. Keep Posts and
		// Pages, then admit public UI-visible custom types.
		if ( ! in_array( $type->name, array( 'post', 'page' ), true ) && ! $type->public ) {
			continue;
		}
		if ( $os->can( $type->cap->edit_posts ) ) {
			$types[] = $type->name;
		}
	}
	return array_values( array_unique( $types ) );
}

/**
 * The current user's five most recently modified editable items.
 *
 * @param Os       $os         Host handle.
 * @param string[] $post_types Editable post types.
 * @return array[]
 */
function recent_work( Os $os, array $post_types ) {
	if ( array() === $post_types ) {
		return array();
	}

	$query = new WP_Query(
		array(
			'post_type'              => $post_types,
			'post_status'            => array( 'draft', 'pending', 'future', 'private', 'publish' ),
			'author'                 => $os->auth->user_id(),
			'posts_per_page'         => 5,
			'orderby'                => 'modified',
			'order'                  => 'DESC',
			'ignore_sticky_posts'    => true,
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
		)
	);

	$items = array();
	foreach ( $query->posts as $post ) {
		$edit_url = get_edit_post_link( $post->ID, 'raw' );
		if ( ! is_string( $edit_url ) || '' === $edit_url ) {
			continue;
		}

		$type_object   = get_post_type_object( $post->post_type );
		$status_object = get_post_status_object( $post->post_status );
		$title         = get_the_title( $post );
		$modified_gmt  = (string) get_post_field( 'post_modified_gmt', $post );
		$modified_iso  = '';
		if ( '' !== $modified_gmt && '0000-00-00 00:00:00' !== $modified_gmt ) {
			$timestamp = strtotime( $modified_gmt . ' UTC' );
			if ( false !== $timestamp ) {
				$modified_iso = gmdate( 'c', $timestamp );
			}
		}

		$items[] = array(
			'id'          => (int) $post->ID,
			'title'       => '' !== trim( $title ) ? $title : __( '(Untitled)', 'desktop-mode' ),
			'typeLabel'   => $type_object ? $type_object->labels->singular_name : __( 'Content', 'desktop-mode' ),
			'icon'        => 'page' === $post->post_type ? 'dashicons-admin-page' : 'dashicons-admin-post',
			'status'      => (string) $post->post_status,
			'statusLabel' => $status_object ? $status_object->label : ucfirst( (string) $post->post_status ),
			'modifiedGmt' => $modified_iso,
			'editUrl'     => esc_url_raw( $edit_url ),
		);
	}

	return $items;
}

/**
 * Count the current user's drafts across the editable types.
 *
 * @param Os       $os         Host handle.
 * @param string[] $post_types Editable post types.
 * @return int
 */
function draft_count( Os $os, array $post_types ) {
	if ( array() === $post_types ) {
		return 0;
	}
	$query = new WP_Query(
		array(
			'post_type'      => $post_types,
			'post_status'    => 'draft',
			'author'         => $os->auth->user_id(),
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'no_found_rows'  => false,
		)
	);
	return (int) $query->found_posts;
}

/**
 * Count published posts and pages on the site.
 *
 * @return int
 */
function published_count() {
	$total = 0;
	foreach ( array( 'post', 'page' ) as $post_type ) {
		$counts = wp_count_posts( $post_type );
		$total += isset( $counts->publish ) ? (int) $counts->publish : 0;
	}
	return $total;
}

/**
 * Count image attachments whose alternative text is empty or absent —
 * only for a user who can remediate it.
 *
 * @param Os $os Host handle.
 * @return int
 */
function missing_alt_count( Os $os ) {
	if ( ! $os->can( 'upload_files' ) ) {
		return 0;
	}

	$query = new WP_Query(
		array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'post_mime_type' => 'image',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'no_found_rows'  => false,
			'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- one bounded dashboard count, only for users who can remediate it.
				'relation' => 'OR',
				array(
					'key'     => '_wp_attachment_image_alt',
					'compare' => 'NOT EXISTS',
				),
				array(
					'key'     => '_wp_attachment_image_alt',
					'value'   => '',
					'compare' => '=',
				),
			),
		)
	);
	return (int) $query->found_posts;
}

/**
 * WordPress's cached update totals — no network request is made.
 *
 * @param Os $os Host handle.
 * @return int
 */
function update_count( Os $os ) {
	if ( ! $os->can( 'update_core' ) && ! $os->can( 'update_plugins' ) && ! $os->can( 'update_themes' ) ) {
		return 0;
	}

	if ( ! function_exists( 'wp_get_update_data' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	$data = wp_get_update_data();
	return isset( $data['counts']['total'] ) ? (int) $data['counts']['total'] : 0;
}

/**
 * The rail's quick actions, gated per capability.
 *
 * `url` and `external` actions are links the shell's link interceptor
 * opens in a window (or, for `external`, a new tab). `native` and
 * `classic` actions have no URL the interceptor may follow — a native
 * window has none, and the classic escape is the one admin URL the
 * interceptor deliberately refuses — so they are buttons that
 * dispatch `launch`, which turns them into the `open` / `open_url`
 * effects.
 *
 * @param Os $os Host handle.
 * @return array[]
 */
function quick_actions( Os $os ) {
	$actions = array();
	if ( $os->can( 'edit_posts' ) ) {
		$actions[] = array(
			'id'    => 'new-post',
			'label' => __( 'New post', 'desktop-mode' ),
			'icon'  => 'dashicons-edit',
			'kind'  => 'url',
			'url'   => esc_url_raw( admin_url( 'post-new.php' ) ),
		);
	}
	if ( $os->can( 'upload_files' ) ) {
		$actions[] = array(
			'id'    => 'upload-media',
			'label' => __( 'Upload media', 'desktop-mode' ),
			'icon'  => 'dashicons-upload',
			'kind'  => 'url',
			'url'   => esc_url_raw( admin_url( 'media-new.php' ) ),
		);
	}
	$actions[] = array(
		'id'    => 'view-site',
		'label' => __( 'View site', 'desktop-mode' ),
		'icon'  => 'dashicons-visibility',
		'kind'  => 'external',
		'url'   => esc_url_raw( home_url( '/' ) ),
	);
	if ( function_exists( 'openstation_my_wordpress_user_can_use' ) && openstation_my_wordpress_user_can_use() ) {
		$actions[] = array(
			'id'       => 'wp-explorer',
			'label'    => __( 'WP Explorer', 'desktop-mode' ),
			'icon'     => 'dashicons-open-folder',
			'kind'     => 'native',
			'windowId' => 'my-wordpress',
		);
	}
	$actions[] = array(
		'id'    => 'classic-dashboard',
		'label' => __( 'Classic Dashboard', 'desktop-mode' ),
		'icon'  => 'dashicons-dashboard',
		'kind'  => 'classic',
		'url'   => esc_url_raw( add_query_arg( OPENSTATION_CLASSIC_FLAG, '1', admin_url( 'index.php' ) ) ),
	);
	return $actions;
}

/**
 * The attention queue: pending comments, available updates, images
 * without alt text — each only when its count is above zero.
 *
 * @param int $pending     Pending comments the user may moderate.
 * @param int $updates     Available updates the user may apply.
 * @param int $missing_alt Images without alt text the user may fix.
 * @return array[]
 */
function attention( $pending, $updates, $missing_alt ) {
	$queue = array();
	if ( $pending > 0 ) {
		$queue[] = array(
			'id'          => 'comments',
			'icon'        => 'dashicons-admin-comments',
			'count'       => $pending,
			'label'       => sprintf(
				/* translators: %s: pending comment count. */
				_n( '%s pending comment', '%s pending comments', $pending, 'desktop-mode' ),
				number_format_i18n( $pending )
			),
			'description' => __( 'Review and reply to keep the conversation moving.', 'desktop-mode' ),
			'url'         => esc_url_raw( admin_url( 'edit-comments.php?comment_status=moderated' ) ),
		);
	}
	if ( $updates > 0 ) {
		$queue[] = array(
			'id'          => 'updates',
			'icon'        => 'dashicons-update',
			'count'       => $updates,
			'label'       => sprintf(
				/* translators: %s: update count. */
				_n( '%s update available', '%s updates available', $updates, 'desktop-mode' ),
				number_format_i18n( $updates )
			),
			'description' => __( 'Keep WordPress, themes, and plugins current.', 'desktop-mode' ),
			'url'         => esc_url_raw( admin_url( 'update-core.php' ) ),
		);
	}
	if ( $missing_alt > 0 ) {
		$queue[] = array(
			'id'          => 'missing-alt',
			'icon'        => 'dashicons-format-image',
			'count'       => $missing_alt,
			'label'       => sprintf(
				/* translators: %s: image count. */
				_n( '%s image needs alt text', '%s images need alt text', $missing_alt, 'desktop-mode' ),
				number_format_i18n( $missing_alt )
			),
			'description' => __( 'Add a useful description for people using assistive technology.', 'desktop-mode' ),
			'url'         => esc_url_raw( admin_url( 'upload.php?mode=list' ) ),
		);
	}
	return $queue;
}

/**
 * Assemble the role-aware snapshot the view paints from.
 *
 * @param Os $os Host handle.
 * @return array<string,mixed>
 */
function snapshot( Os $os ) {
	$user         = wp_get_current_user();
	$post_types   = editable_post_types( $os );
	$drafts       = draft_count( $os, $post_types );
	$published    = published_count();
	$comment_data = wp_count_comments();
	$pending      = $os->can( 'moderate_comments' ) ? (int) $comment_data->moderated : 0;
	$updates      = update_count( $os );
	$missing_alt  = missing_alt_count( $os );
	$first_name   = trim( (string) get_user_meta( $user->ID, 'first_name', true ) );
	$cards        = openstation_station_home_build_cards(
		openstation_station_home_get_registered_cards(),
		openstation_station_home_get_card_preferences( $user->ID )
	);

	return array(
		'userName'        => '' !== $first_name ? $first_name : $user->display_name,
		'siteName'        => get_bloginfo( 'name' ),
		'work'            => recent_work( $os, $post_types ),
		'quickActions'    => quick_actions( $os ),
		'metrics'         => array(
			array(
				'id'    => 'drafts',
				'label' => __( 'Drafts', 'desktop-mode' ),
				'icon'  => 'dashicons-edit',
				'value' => $drafts,
			),
			array(
				'id'    => 'comments',
				'label' => __( 'Pending comments', 'desktop-mode' ),
				'icon'  => 'dashicons-admin-comments',
				'value' => $pending,
			),
			array(
				'id'    => 'updates',
				'label' => __( 'Updates', 'desktop-mode' ),
				'icon'  => 'dashicons-update',
				'value' => $updates,
			),
			array(
				'id'    => 'published',
				'label' => __( 'Published', 'desktop-mode' ),
				'icon'  => 'dashicons-admin-site-alt3',
				'value' => $published,
			),
		),
		'attention'       => attention( $pending, $updates, $missing_alt ),
		'cards'           => $cards['cards'],
		'cardPreferences' => $cards['preferences'],
	);
}
