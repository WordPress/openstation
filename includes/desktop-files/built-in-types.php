<?php
/**
 * OpenStation — built-in file-type registrations.
 *
 * Registers the file types that ship with the plugin
 * through the same public API third-party plugins use. Hooked on
 * `init` priority 5 so the types land in the registry before the
 * shell config is built and before any third-party plugin that
 * wants to react via `openstation_file_type_registered`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the built-in file types (post, attachment, user,
 * term, comment, bookmark, folder, shortcut, link, embed).
 */
function openstation_register_builtin_file_types() {
	$types = array(
		array(
			'type'  => 'post',
			'label' => __( 'Post', 'desktop-mode' ),
			'class' => 'OpenStation_Post_File',
			'sort'  => 10,
		),
		array(
			'type'  => 'attachment',
			'label' => __( 'Media', 'desktop-mode' ),
			'class' => 'OpenStation_Attachment_File',
			'sort'  => 20,
		),
		array(
			'type'  => 'upload',
			'label' => __( 'Uploaded file', 'desktop-mode' ),
			'class' => 'OpenStation_Upload_File',
			'sort'  => 25,
		),
		array(
			'type'  => 'user',
			'label' => __( 'User', 'desktop-mode' ),
			'class' => 'OpenStation_User_File',
			'sort'  => 30,
		),
		array(
			'type'  => 'term',
			'label' => __( 'Taxonomy term', 'desktop-mode' ),
			'class' => 'OpenStation_Term_File',
			'sort'  => 40,
		),
		array(
			'type'  => 'comment',
			'label' => __( 'Comment', 'desktop-mode' ),
			'class' => 'OpenStation_Comment_File',
			'sort'  => 50,
		),
		array(
			'type'  => 'bookmark',
			'label' => __( 'Bookmark', 'desktop-mode' ),
			'class' => 'OpenStation_Bookmark_File',
			'sort'  => 60,
		),
		array(
			'type'  => 'folder',
			'label' => __( 'Folder', 'desktop-mode' ),
			'class' => 'OpenStation_Folder_File',
			'sort'  => 5,
		),
		array(
			'type'  => 'shortcut',
			'label' => __( 'Plugin shortcut', 'desktop-mode' ),
			'class' => 'OpenStation_Shortcut_File',
			'sort'  => 1,
		),
		array(
			'type'  => 'link',
			'label' => __( 'Web link', 'desktop-mode' ),
			'class' => 'OpenStation_Link_File',
			'sort'  => 70,
		),
		array(
			'type'  => 'embed',
			'label' => __( 'Embedded web window', 'desktop-mode' ),
			'class' => 'OpenStation_Embed_File',
			'sort'  => 80,
		),
	);

	foreach ( $types as $args ) {
		openstation_register_file_type(
			$args['type'],
			array(
				'label' => $args['label'],
				'class' => $args['class'],
				'sort'  => $args['sort'],
			)
		);
	}
}
add_action( 'init', 'openstation_register_builtin_file_types', 5 );
