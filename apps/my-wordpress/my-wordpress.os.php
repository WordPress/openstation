<?php
/**
 * My WordPress — the content explorer, as an OpenStation app.
 *
 * The whole window in this one file: the root folder grid (the four
 * builtin sections plus every eligible custom post type, grouped into
 * plugin folders exactly as WP Explorer groups them), a two-pane
 * section view — searchable, sortable, paged list on the left, the
 * selected item's dossier on the right — multi-select with bulk
 * trash, double-click to edit, a per-row context menu, media usage
 * ("used in") and user footprint facts. The body is a server view —
 * the app ships no JavaScript — and every list is queried where
 * WordPress already is: `WP_Query` / `WP_User_Query` in the dispatch,
 * not `wp/v2/*` REST from the browser. `watch( '*' )` keeps it
 * honest: when any window changes any content, this one repaints.
 *
 * Custom post types are not re-discovered here: the app calls the
 * same `openstation_my_wordpress_*` helpers WP Explorer uses
 * (`eligible_post_types`, `post_type_icon`, `post_type_group`,
 * `collect_groups`), so both windows always agree on what a site
 * contains — and their filters keep working. This is a sibling of WP
 * Explorer (`desktop-mode-my-wordpress`), not a replacement.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;
use function OpenStation\App\Html\esc;
use function OpenStation\App\Html\tag;

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
 * One page of a section, in the uniform shape every view renders:
 * `items` (each: `id`, `title`, `subtitle`, `status`, `thumb`),
 * `total`, `pages`.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State (`query`, `page`, `sort`).
 * @return array{items:array[],total:int,pages:int}
 */
function fetch( array $section, State $state ) {
	$query               = (string) $state->get( 'query' );
	$page                = max( 1, (int) $state->get( 'page' ) );
	list( $by, $order )  = sort_of( $section, $state );

	if ( 'user' === $section['kind'] ) {
		$users = new \WP_User_Query(
			array(
				'number'      => PER_PAGE,
				'offset'      => ( $page - 1 ) * PER_PAGE,
				'search'      => '' !== $query ? '*' . $query . '*' : '',
				'orderby'     => $by,
				'order'       => $order,
				'count_total' => true,
			)
		);
		$items = array();
		foreach ( $users->get_results() as $user ) {
			$items[] = array(
				'id'       => (int) $user->ID,
				'title'    => (string) $user->display_name,
				'subtitle' => (string) $user->user_email,
				'status'   => implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ),
				'thumb'    => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
			);
		}
		$total = (int) $users->get_total();
		return array(
			'items' => $items,
			'total' => $total,
			'pages' => max( 1, (int) ceil( $total / PER_PAGE ) ),
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
			'orderby'        => $by,
			'order'          => $order,
		)
	);
	$items    = array();
	foreach ( $posts->posts as $post ) {
		$items[] = array(
			'id'       => (int) $post->ID,
			'title'    => '' !== $post->post_title ? (string) $post->post_title : __( '(no title)', 'desktop-mode' ),
			'subtitle' => $is_media
				? (string) $post->post_mime_type
				: sprintf(
					/* translators: 1: author display name, 2: date. */
					__( '%1$s — %2$s', 'desktop-mode' ),
					(string) get_the_author_meta( 'display_name', (int) $post->post_author ),
					(string) get_the_date( '', $post )
				),
			'status'   => $is_media ? '' : (string) $post->post_status,
			'thumb'    => ! empty( $section['thumbnails'] )
				? ( $is_media
					? (string) wp_get_attachment_image_url( $post->ID, 'medium' )
					: (string) get_the_post_thumbnail_url( $post, 'thumbnail' ) )
				: '',
		);
	}
	return array(
		'items' => $items,
		'total' => (int) $posts->found_posts,
		'pages' => max( 1, (int) $posts->max_num_pages ),
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

// --------------------------------------------------------------- views

/**
 * An icon reference as markup: a Dashicons class renders as a glyph,
 * anything else (URL, data URI — a CPT's `menu_icon`) as an image.
 *
 * @param string $icon  Icon reference.
 * @param string $class Extra class for the element.
 * @return string
 */
function glyph( $icon, $class = '' ) {
	if ( 0 === strpos( $icon, 'dashicons-' ) ) {
		return '<span class="' . esc( trim( $class . ' dashicons ' . $icon ) ) . '" aria-hidden="true"></span>';
	}
	return tag(
		'img',
		array(
			'class' => trim( $class . ' os-mywp__icon-img' ),
			'src'   => $icon,
			'alt'   => '',
		)
	);
}

/**
 * One root tile: a folder or a section, labelled `Label · N`.
 *
 * @param array<string,mixed> $args  Trigger args (`group` / `section`).
 * @param string              $label Label.
 * @param string              $icon  Icon reference.
 * @param int                 $count Item count.
 * @param string              $key   Morph identity.
 * @return string
 */
function root_tile( array $args, $label, $icon, $count, $key ) {
	$attrs = array(
		'type'      => 'button',
		'class'     => 'os-mywp__tile',
		'os-key'    => $key,
		'os-on'     => 'click',
		'os-action' => 'go',
	);
	foreach ( $args as $name => $value ) {
		$attrs[ 'os-arg-' . $name ] = $value;
	}
	return tag(
		'button',
		$attrs,
		glyph( $icon, 'os-mywp__tile-icon' )
			. '<span class="os-mywp__tile-label">' . esc( $label ) . ' · ' . esc( number_format_i18n( $count ) ) . '</span>'
	);
}

/**
 * The breadcrumb header: back chevron, the trail, and the search
 * field inside a section.
 *
 * @param Os                       $os      Host handle.
 * @param array<string,mixed>|null $group   Current group, if inside one.
 * @param array<string,mixed>|null $section Current section.
 * @param State                    $state   State.
 * @return string
 */
function header_bar( Os $os, $group, $section, State $state ) {
	$back = '';
	if ( $group || $section ) {
		$back = tag(
			'os-button',
			array(
				'variant'    => 'ghost',
				'class'      => 'os-mywp__back',
				'aria-label' => __( 'Back', 'desktop-mode' ),
				'os-action'  => 'back',
			),
			'‹'
		);
	}
	$crumbs = tag(
		'os-button',
		array(
			'variant'   => 'ghost',
			'os-action' => 'go',
		),
		esc( get_bloginfo( 'name' ) )
	);
	if ( $group ) {
		$crumbs .= '<span class="os-mywp__sep" aria-hidden="true">›</span>';
		$crumbs .= tag(
			'os-button',
			array(
				'variant'      => 'ghost',
				'os-action'    => 'go',
				'os-arg-group' => $group['id'],
			),
			esc( $group['label'] )
		);
	}
	if ( $section ) {
		$crumbs .= '<span class="os-mywp__sep" aria-hidden="true">›</span>';
		$args    = array(
			'variant'        => 'ghost',
			'os-action'      => 'go',
			'os-arg-section' => $section['id'],
		);
		if ( $group ) {
			$args['os-arg-group'] = $group['id'];
		}
		$crumbs .= tag( 'os-button', $args, esc( $section['label'] ) );
	}
	$search = '';
	if ( $section ) {
		$search = tag(
			'os-text-field',
			array(
				'value'       => (string) $state->get( 'query' ),
				'placeholder' => sprintf(
					/* translators: %s: section label. */
					__( 'Search %s…', 'desktop-mode' ),
					$section['label']
				),
				'os-bind'     => 'query',
				'os-action'   => 'search',
			)
		);
	}
	return '<header class="os-mywp__header">' . $back . '<nav class="os-mywp__crumbs">' . $crumbs . '</nav>' . $search . '</header>';
}

/**
 * The root (or one group's) folder grid.
 *
 * @param Os     $os       Host handle.
 * @param string $group_id Group to render, '' for the root.
 * @return array{html:string,status:string}
 */
function render_root( Os $os, $group_id = '' ) {
	$sections = sections( $os );
	$tiles    = '';
	$shown    = 0;

	if ( '' === $group_id ) {
		foreach ( $sections as $section ) {
			if ( ! empty( $section['group'] ) ) {
				continue;
			}
			$tiles .= root_tile(
				array( 'section' => $section['id'] ),
				(string) $section['label'],
				(string) $section['icon'],
				count_of( $section ),
				'section-' . $section['id']
			);
			$shown++;
		}
		foreach ( groups( $sections ) as $group ) {
			$count = 0;
			foreach ( $sections as $section ) {
				if ( ( $section['group'] ?? null ) === $group['id'] ) {
					$count += count_of( $section );
				}
			}
			$tiles .= root_tile(
				array( 'group' => $group['id'] ),
				(string) $group['label'],
				(string) $group['icon'],
				$count,
				'group-' . $group['id']
			);
			$shown++;
		}
	} else {
		foreach ( $sections as $section ) {
			if ( ( $section['group'] ?? null ) !== $group_id ) {
				continue;
			}
			$tiles .= root_tile(
				array(
					'group'   => $group_id,
					'section' => $section['id'],
				),
				(string) $section['label'],
				(string) $section['icon'],
				count_of( $section ),
				'section-' . $section['id']
			);
			$shown++;
		}
	}

	return array(
		'html'   => '<div class="os-mywp__root" role="list">' . $tiles . '</div>',
		'status' => sprintf(
			/* translators: %s: folder count. */
			_n( '%s folder', '%s folders', $shown, 'desktop-mode' ),
			number_format_i18n( $shown )
		),
	);
}

/**
 * The list pane: toolbar (sort + bulk bar), rows or thumbnail grid,
 * and the pager.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State.
 * @return array{html:string,status:string}
 */
function render_list( Os $os, array $section, State $state ) {
	$result   = fetch( $section, $state );
	$selected = array_map( 'intval', (array) $state->get( 'selected' ) );
	$open_id  = (int) $state->get( 'item' );

	$options = '';
	foreach ( sort_options( $section ) as $value => $row ) {
		$options .= tag(
			'os-option',
			array(
				'value'    => $value,
				'selected' => $value === (string) $state->get( 'sort' ) || ( 'default' === $value && ! $state->get( 'sort' ) ),
			),
			esc( $row[0] )
		);
	}
	$toolbar = '<div class="os-mywp__toolbar">'
		. tag(
			'os-select',
			array(
				'value'   => '' !== (string) $state->get( 'sort' ) ? (string) $state->get( 'sort' ) : 'default',
				'os-bind' => 'sort',
			),
			$options
		);
	if ( array() !== $selected ) {
		$toolbar .= '<div class="os-mywp__bulk">'
			. '<span>' . esc(
				sprintf(
					/* translators: %s: selected count. */
					_n( '%s selected', '%s selected', count( $selected ), 'desktop-mode' ),
					number_format_i18n( count( $selected ) )
				)
			) . '</span>';
		if ( 'post' === $section['kind'] ) {
			$toolbar .= tag(
				'os-button',
				array(
					'variant'           => 'danger',
					'os-action'         => 'bulk-trash',
					'os-confirm'        => __( 'Move the selected items to the Trash?', 'desktop-mode' ),
					'os-confirm-label'  => __( 'Trash', 'desktop-mode' ),
					'os-confirm-danger' => true,
				),
				esc( __( 'Trash selected', 'desktop-mode' ) )
			);
		}
		$toolbar .= tag(
			'os-button',
			array(
				'variant'   => 'ghost',
				'os-action' => 'clear-select',
			),
			esc( __( 'Clear', 'desktop-mode' ) )
		) . '</div>';
	}
	$toolbar .= '</div>';

	if ( array() === $result['items'] ) {
		return array(
			'html'   => $toolbar . tag(
				'os-empty-state',
				array( 'icon' => 0 === strpos( (string) $section['icon'], 'dashicons-' ) ? $section['icon'] : 'dashicons-portfolio' ),
				esc(
					'' !== (string) $state->get( 'query' )
						? __( 'Nothing matches the search.', 'desktop-mode' )
						: __( 'Nothing here yet.', 'desktop-mode' )
				)
			),
			'status' => __( 'Empty', 'desktop-mode' ),
		);
	}

	$rows = '';
	foreach ( $result['items'] as $item ) {
		$art  = '' !== $item['thumb']
			? tag(
				'img',
				array(
					'class'   => 'os-mywp__thumb',
					'src'     => $item['thumb'],
					'alt'     => '',
					'loading' => 'lazy',
				)
			)
			: glyph( (string) $section['icon'], 'os-mywp__glyph' );
		$meta = '<span class="os-mywp__title">' . esc( $item['title'] ) . '</span>'
			. '<span class="os-mywp__subtitle">' . esc( $item['subtitle'] ) . '</span>';
		$flag = '' !== $item['status'] && 'publish' !== $item['status']
			? tag( 'os-badge', array( 'no-dot' => true ), esc( ucfirst( $item['status'] ) ) )
			: '';
		$pick = tag(
			'input',
			array(
				'type'        => 'checkbox',
				'class'       => 'os-mywp__pick',
				'checked'     => in_array( (int) $item['id'], $selected, true ),
				'aria-label'  => sprintf(
					/* translators: %s: item title. */
					__( 'Select %s', 'desktop-mode' ),
					$item['title']
				),
				'os-action'   => 'pick',
				'os-arg-item' => $item['id'],
			)
		);
		// Three nested triggers, one per gesture: click on the row opens
		// the dossier pane, double-click anywhere on it opens the editor,
		// right-click pops the actions menu. Each wrapper answers only
		// its own event, so they never shadow each other.
		$rows .= tag(
			'div',
			array(
				'class'       => 'os-mywp__row-wrap',
				'os-key'      => 'item-' . $item['id'],
				'os-on'       => 'contextmenu',
				'os-action'   => 'row-menu',
				'os-arg-item' => $item['id'],
			),
			tag(
				'div',
				array(
					'class'       => 'os-mywp__row' . ( $open_id === (int) $item['id'] ? ' is-open' : '' ),
					'os-on'       => 'dblclick',
					'os-action'   => 'edit',
					'os-arg-item' => $item['id'],
				),
				$pick . tag(
					'button',
					array(
						'type'        => 'button',
						'class'       => 'os-mywp__row-open',
						'os-on'       => 'click',
						'os-action'   => 'open',
						'os-arg-item' => $item['id'],
					),
					$art . '<span class="os-mywp__meta">' . $meta . '</span>' . $flag
				)
			)
		);
	}

	$page  = max( 1, (int) $state->get( 'page' ) );
	$pager = '<footer class="os-mywp__pager">'
		. tag(
			'os-button',
			array(
				'variant'     => 'ghost',
				'os-action'   => 'paginate',
				'os-arg-page' => $page - 1,
				'disabled'    => $page <= 1,
			),
			esc( __( 'Previous', 'desktop-mode' ) )
		)
		. '<span class="os-mywp__count">' . esc(
			sprintf(
				/* translators: 1: current page, 2: page count. */
				__( 'Page %1$d of %2$d', 'desktop-mode' ),
				$page,
				$result['pages']
			)
		) . '</span>'
		. tag(
			'os-button',
			array(
				'variant'     => 'ghost',
				'os-action'   => 'paginate',
				'os-arg-page' => $page + 1,
				'disabled'    => $page >= $result['pages'],
			),
			esc( __( 'Next', 'desktop-mode' ) )
		)
		. '</footer>';

	$mode   = 'media' === $section['kind'] ? ' os-mywp__list--grid' : '';
	$status = sprintf(
		/* translators: %s: item count. */
		_n( '%s item', '%s items', $result['total'], 'desktop-mode' ),
		number_format_i18n( $result['total'] )
	);
	if ( array() !== $selected ) {
		$status .= ' — ' . sprintf(
			/* translators: %s: selected count. */
			__( '%s selected', 'desktop-mode' ),
			number_format_i18n( count( $selected ) )
		);
	}
	return array(
		'html'   => $toolbar . '<div class="os-mywp__list' . esc( $mode ) . '" role="list">' . $rows . '</div>' . $pager,
		'status' => $status,
	);
}

/**
 * One dossier row.
 *
 * @param string $label Field label.
 * @param string $value Field value (plain text).
 * @return string
 */
function fact( $label, $value ) {
	if ( '' === $value ) {
		return '';
	}
	return '<div class="os-mywp__fact"><dt>' . esc( $label ) . '</dt><dd>' . esc( $value ) . '</dd></div>';
}

/**
 * The detail dossier for the open item — the right pane.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State (`item`).
 * @return string
 */
function render_detail( Os $os, array $section, State $state ) {
	$id = (int) $state->get( 'item' );

	$title = '';
	$art   = '';
	$facts = '';
	$extra = '';
	if ( 'user' === $section['kind'] ) {
		$user = get_userdata( $id );
		if ( ! $user ) {
			return tag( 'os-empty-state', array(), esc( __( 'This user no longer exists.', 'desktop-mode' ) ) );
		}
		$title = (string) $user->display_name;
		$art   = tag(
			'os-avatar',
			array(
				'src'  => (string) get_avatar_url( $id, array( 'size' => 192 ) ),
				'name' => $title,
				'size' => 'xl',
			)
		);
		$facts = fact( __( 'Email', 'desktop-mode' ), (string) $user->user_email )
			. fact( __( 'Role', 'desktop-mode' ), implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ) )
			. fact( __( 'Registered', 'desktop-mode' ), (string) date_i18n( get_option( 'date_format' ), strtotime( $user->user_registered ) ) )
			. fact( __( 'Posts', 'desktop-mode' ), number_format_i18n( count_user_posts( $id ) ) )
			. fact(
				__( 'Comments', 'desktop-mode' ),
				number_format_i18n(
					(int) get_comments(
						array(
							'user_id' => $id,
							'count'   => true,
						)
					)
				)
			);
	} else {
		$post = get_post( $id );
		if ( ! $post || $post->post_type !== $section['post_type'] ) {
			return tag( 'os-empty-state', array(), esc( __( 'This item no longer exists.', 'desktop-mode' ) ) );
		}
		$title = '' !== $post->post_title ? (string) $post->post_title : __( '(no title)', 'desktop-mode' );
		if ( 'media' === $section['kind'] ) {
			$src   = (string) wp_get_attachment_image_url( $id, 'large' );
			$art   = '' !== $src
				? tag(
					'img',
					array(
						'class' => 'os-mywp__hero',
						'src'   => $src,
						'alt'   => $title,
					)
				)
				: '';
			$file  = get_attached_file( $id );
			$meta  = (array) wp_get_attachment_metadata( $id );
			$facts = fact( __( 'Type', 'desktop-mode' ), (string) $post->post_mime_type )
				. fact( __( 'Size', 'desktop-mode' ), $file && file_exists( $file ) ? size_format( (int) filesize( $file ) ) : '' )
				. fact(
					__( 'Dimensions', 'desktop-mode' ),
					isset( $meta['width'], $meta['height'] ) ? $meta['width'] . ' × ' . $meta['height'] : ''
				)
				. fact( __( 'Uploaded', 'desktop-mode' ), (string) get_the_date( '', $post ) );
			// Where the file is actually used — WP Explorer's usage scan,
			// straight from the same helper. Viewer-specific by contract.
			if ( function_exists( 'openstation_my_wordpress_media_usage_build' ) ) {
				$usage = openstation_my_wordpress_media_usage_build( $post );
				$rows  = '';
				foreach ( array_slice( (array) ( $usage['usedIn'] ?? array() ), 0, 8 ) as $used ) {
					$rows .= '<li>' . esc( (string) ( $used['title'] ?? '' ) )
						. ' <span class="os-mywp__subtitle">' . esc( (string) ( $used['usedAs'] ?? '' ) ) . '</span></li>';
				}
				$extra = '<h3 class="os-mywp__pane-h">' . esc( __( 'Used in', 'desktop-mode' ) ) . '</h3>'
					. ( '' !== $rows
						? '<ul class="os-mywp__used-in">' . $rows . '</ul>'
						: '<p class="os-mywp__subtitle">' . esc( __( 'Not used anywhere yet.', 'desktop-mode' ) ) . '</p>' );
			}
		} else {
			$thumb = (string) get_the_post_thumbnail_url( $post, 'large' );
			$art   = '' !== $thumb
				? tag(
					'img',
					array(
						'class' => 'os-mywp__hero',
						'src'   => $thumb,
						'alt'   => '',
					)
				)
				: '';
			$facts = fact( __( 'Status', 'desktop-mode' ), ucfirst( (string) $post->post_status ) )
				. fact( __( 'Author', 'desktop-mode' ), (string) get_the_author_meta( 'display_name', (int) $post->post_author ) )
				. fact( __( 'Published', 'desktop-mode' ), (string) get_the_date( '', $post ) )
				. fact( __( 'Modified', 'desktop-mode' ), (string) get_the_modified_date( '', $post ) )
				. fact( __( 'Words', 'desktop-mode' ), number_format_i18n( str_word_count( wp_strip_all_tags( (string) $post->post_content ) ) ) );
		}
	}

	$actions = '';
	if ( allowed( $os, $section, $id, 'edit' ) ) {
		$actions .= tag(
			'os-button',
			array(
				'variant'     => 'primary',
				'os-action'   => 'edit',
				'os-arg-item' => $id,
			),
			esc( 'user' === $section['kind'] ? __( 'Edit profile', 'desktop-mode' ) : __( 'Open in editor', 'desktop-mode' ) )
		);
	}
	if ( 'post' === $section['kind'] && allowed( $os, $section, $id, 'delete' ) ) {
		$actions .= tag(
			'os-button',
			array(
				'variant'           => 'danger',
				'os-action'         => 'trash',
				'os-arg-item'       => $id,
				'os-confirm'        => __( 'Move this to the Trash?', 'desktop-mode' ),
				'os-confirm-label'  => __( 'Trash', 'desktop-mode' ),
				'os-confirm-danger' => true,
			),
			esc( __( 'Trash', 'desktop-mode' ) )
		);
	}

	$close = tag(
		'os-button',
		array(
			'variant'    => 'ghost',
			'class'      => 'os-mywp__pane-close',
			'aria-label' => __( 'Close details', 'desktop-mode' ),
			'os-action'  => 'open',
			'os-arg-item' => 0,
		),
		'✕'
	);

	return '<article class="os-mywp__detail">'
		. $close
		. $art
		. '<h2 class="os-mywp__detail-title">' . esc( $title ) . '</h2>'
		. '<dl class="os-mywp__facts">' . $facts . '</dl>'
		. $extra
		. '<div class="os-mywp__actions">' . $actions . '</div>'
		. '</article>';
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
	// Re-rendering IS the refresh; the handler has nothing to do.
	->action( 'refresh', static function () {} )
	->action(
		'go',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'group', isset( $args['group'] ) ? (string) $args['group'] : '' );
			$state->set( 'section', isset( $args['section'] ) ? (string) $args['section'] : '' );
			$state->set( 'item', 0 )->set( 'query', '' )->set( 'page', 1 )
				->set( 'sort', '' )->reset( 'selected' );
		}
	)
	->action(
		'back',
		static function ( State $state ) {
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
		'search',
		static function ( State $state ) {
			$state->set( 'page', 1 )->set( 'item', 0 )->reset( 'selected' );
		}
	)
	->action(
		'paginate',
		static function ( State $state, Os $os, array $args ) {
			$state->set( 'page', max( 1, (int) ( $args['page'] ?? 1 ) ) )->reset( 'selected' );
		}
	)
	->action(
		'pick',
		static function ( State $state, Os $os, array $args ) {
			$id = (int) ( $args['item'] ?? 0 );
			if ( $id > 0 ) {
				$state->toggle_item( 'selected', $id );
			}
		}
	)
	->action(
		'clear-select',
		static function ( State $state ) {
			$state->reset( 'selected' );
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
	->action(
		'row-menu',
		static function ( State $state, Os $os, array $args ) {
			$section = section_of( $os, (string) $state->get( 'section' ) );
			$id      = (int) ( $args['item'] ?? 0 );
			if ( ! $section || $id <= 0 ) {
				return;
			}
			$items = array(
				array(
					'label'  => __( 'Open', 'desktop-mode' ),
					'action' => 'open',
					'args'   => array( 'item' => $id ),
				),
			);
			if ( allowed( $os, $section, $id, 'edit' ) ) {
				$items[] = array(
					'label'  => 'user' === $section['kind'] ? __( 'Edit profile', 'desktop-mode' ) : __( 'Open in editor', 'desktop-mode' ),
					'action' => 'edit',
					'args'   => array( 'item' => $id ),
				);
			}
			if ( 'post' === $section['kind'] ) {
				$items[] = array(
					'label'    => __( 'Trash', 'desktop-mode' ),
					'action'   => 'trash',
					'args'     => array( 'item' => $id ),
					'danger'   => true,
					'disabled' => ! allowed( $os, $section, $id, 'delete' ),
				);
			}
			$os->menu( $items );
		}
	)
	->view(
		static function ( State $state, Os $os ) {
			$sections = sections( $os );
			$section  = section_of( $os, (string) $state->get( 'section' ) );
			if ( ! $section && '' !== (string) $state->get( 'section' ) ) {
				// A section that vanished (deactivated plugin, lost cap):
				// fall back to the root rather than a dead end.
				$state->set( 'section', '' )->set( 'item', 0 );
			}
			$group = null;
			foreach ( groups( $sections ) as $candidate ) {
				if ( $candidate['id'] === (string) $state->get( 'group' ) ) {
					$group = $candidate;
				}
			}
			if ( ! $group && '' !== (string) $state->get( 'group' ) ) {
				$state->set( 'group', '' );
			}

			if ( ! $section ) {
				$pane = render_root( $os, $group ? (string) $group['id'] : '' );
				$body = $pane['html'];
			} else {
				$pane = render_list( $os, $section, $state );
				$body = '<div class="os-mywp__split">'
					. '<div class="os-mywp__list-pane">' . $pane['html'] . '</div>'
					. ( (int) $state->get( 'item' ) > 0
						? '<aside class="os-mywp__detail-pane">' . render_detail( $os, $section, $state ) . '</aside>'
						: '' )
					. '</div>';
			}

			echo '<div class="os-mywp">';
			echo header_bar( $os, $group, $section, $state ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built entirely from Html\tag()/esc().
			echo '<div class="os-mywp__body">';
			echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built entirely from Html\tag()/esc().
			echo '</div>';
			echo '<footer class="os-mywp__status">' . esc( $pane['status'] ) . '</footer>';
			echo '</div>';
		}
	);
