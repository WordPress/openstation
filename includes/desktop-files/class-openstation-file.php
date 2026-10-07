<?php

defined( 'ABSPATH' ) || exit;

abstract class OpenStation_File {

	protected $ref = '';

	public function __construct( $ref = '' ) {
		$this->ref = (string) $ref;
	}

	abstract public static function type(): string;

	abstract public function title(): string;

	public function ref(): string {
		return $this->ref;
	}

	public function icon(): string {
		return 'dashicons-media-default';
	}

	public function preview_url(): string {
		return '';
	}

	public function can_read( int $user_id ): bool {
		return true;
	}

	public function exists(): bool {
		return '' !== $this->ref;
	}

	public function serialize(): array {
		$shape = array(
			'type'       => static::type(),
			'ref'        => $this->ref,
			'title'      => openstation_plain_text_title( $this->title() ),
			'icon'       => $this->icon(),
			'previewUrl' => $this->preview_url(),
			'exists'     => $this->exists(),
		);

		return apply_filters( 'openstation_file_serialize', $shape, $this );
	}
}
