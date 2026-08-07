/**
 * OpenStation — `DesktopFile` JS abstract base class.
 *
 * Mirrors the PHP {@link OpenStation_File}. Plugin authors extend
 * this class on the JS side when they want to control rendering of
 * their file-type tiles beyond the metadata the PHP `serialize()`
 * call already shipped. The class is intentionally thin — most
 * tiles render fine from the shape alone.
 */

import type { DesktopFileShape } from './types';

export abstract class DesktopFile {
	/** The serialized shape sent over by PHP. */
	public readonly shape: DesktopFileShape;

	public constructor( shape: DesktopFileShape ) {
		this.shape = shape;
	}

	/** The file-type slug. Subclasses must hard-code this. */
	public abstract type(): string;

	/** Title shown under the tile. Defaults to `shape.title`. */
	public title(): string {
		return this.shape.title;
	}

	/** Dashicon class or data URI. Defaults to `shape.icon`. */
	public icon(): string {
		return this.shape.icon;
	}

	/** Optional preview-image URL. Defaults to `shape.previewUrl`. */
	public previewUrl(): string {
		return this.shape.previewUrl;
	}

	/** Reference (id, URL, …). */
	public ref(): string {
		return this.shape.ref;
	}

	/** Whether the underlying entity still exists. */
	public exists(): boolean {
		return this.shape.exists;
	}
}

/**
 * The default leaf-class implementation used when a file type is
 * registered without a custom JS class. All built-in types start
 * out using this — plugins opt into custom rendering by passing
 * their own `DesktopFile`-extending class to `registerType`.
 */
export class DefaultDesktopFile extends DesktopFile {
	private readonly typeSlug: string;

	public constructor( shape: DesktopFileShape, typeSlug: string ) {
		super( shape );
		this.typeSlug = typeSlug;
	}

	public type(): string {
		return this.typeSlug;
	}
}
