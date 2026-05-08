<?php
/**
 * Desktop Mode — `Desktop_Mode_File` abstract base class.
 *
 * Every "file" that a user can place on the Desktop Mode wallpaper
 * (a post, a user, an attachment, a term, a comment, a folder, a
 * bookmark — or anything a third-party plugin teaches the system
 * about) is represented by a subclass of this base. The subclass
 * adapts a WordPress entity (or any opaque reference string) to the
 * shape the desktop UI expects: a title, an icon, a preview, and a
 * capability gate.
 *
 * Files do NOT know how to open themselves. Opening is a separate
 * concern delegated to the file-opener registry (Phase 1) so the
 * same `post` file can be opened by Gutenberg, the Classic Editor,
 * or any plugin's editor of choice — the user's per-type
 * association decides which.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adapts a WordPress entity to the desktop "file" surface.
 *
 * Subclass contract: implement {@see ::title()} and the static
 * {@see ::type()} slug; override {@see ::icon()}, {@see ::preview_url()},
 * {@see ::can_read()}, or {@see ::serialize()} when the defaults
 * don't fit.
 *
 * @since 0.9.0
 */
abstract class Desktop_Mode_File {

	/**
	 * Opaque reference identifying the underlying entity.
	 *
	 * For most types this is a numeric id (post id, user id,
	 * attachment id, term id, comment id). For `bookmark` it's the
	 * URL itself. For `folder` it's the row id of the folder.
	 *
	 * Stored as a string because the placements table stores it as
	 * a varchar — type coercion happens in the subclass.
	 *
	 * @var string
	 */
	protected $ref = '';

	/**
	 * @param string|int $ref Entity reference.
	 */
	public function __construct( $ref = '' ) {
		$this->ref = (string) $ref;
	}

	/**
	 * The file-type slug, e.g. `'post'`, `'user'`, `'folder'`.
	 *
	 * @return string
	 */
	abstract public static function type(): string;

	/**
	 * Human-readable title displayed under the tile.
	 *
	 * @return string
	 */
	abstract public function title(): string;

	/**
	 * Reference accessor — read-only on purpose.
	 *
	 * @return string
	 */
	public function ref(): string {
		return $this->ref;
	}

	/**
	 * Dashicon class (or `data:` URI) rendered on the tile. Default
	 * is the generic media glyph; subclasses should override.
	 *
	 * @return string
	 */
	public function icon(): string {
		return 'dashicons-media-default';
	}

	/**
	 * Optional preview-image URL (e.g. featured image, avatar,
	 * attachment thumbnail). Empty string when the tile should
	 * render the icon instead.
	 *
	 * @return string
	 */
	public function preview_url(): string {
		return '';
	}

	/**
	 * Whether `$user_id` can see / open this file. Defaults to
	 * `true`; subclasses tighten the gate. For shared folders this
	 * is consulted PER PLACEMENT at snapshot time so a folder
	 * shared with role `editor` cannot expose individual files the
	 * viewer lacks the cap to read.
	 *
	 * @param int $user_id Viewer.
	 * @return bool
	 */
	public function can_read( int $user_id ): bool {
		return true;
	}

	/**
	 * Whether the underlying entity still exists. The renderer uses
	 * this to flag dead references with a placeholder tile rather
	 * than rendering nothing (so the user can right-click → remove).
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return '' !== $this->ref;
	}

	/**
	 * Shape sent to JS. Subclasses extend by overriding and
	 * `array_merge`'ing on top of `parent::serialize()`.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape = array(
			'type'       => static::type(),
			'ref'        => $this->ref,
			'title'      => $this->title(),
			'icon'       => $this->icon(),
			'previewUrl' => $this->preview_url(),
			'exists'     => $this->exists(),
		);

		/**
		 * Filters the serialized shape of a desktop file before it
		 * crosses the wire. Last-mile mutation point — plugins use
		 * this to attach badges, override labels, or splice in
		 * custom render hints without subclassing.
		 *
		 * @since 0.9.0
		 *
		 * @param array             $shape The serialized file shape.
		 * @param Desktop_Mode_File $file  The file being serialized.
		 */
		return apply_filters( 'desktop_mode_file_serialize', $shape, $this );
	}
}
