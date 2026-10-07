import type { DesktopFileShape } from './types';

export abstract class DesktopFile {
	public readonly shape: DesktopFileShape;

	public constructor( shape: DesktopFileShape ) {
		this.shape = shape;
	}

	public abstract type(): string;

	public title(): string {
		return this.shape.title;
	}

	public icon(): string {
		return this.shape.icon;
	}

	public previewUrl(): string {
		return this.shape.previewUrl;
	}

	public ref(): string {
		return this.shape.ref;
	}

	public exists(): boolean {
		return this.shape.exists;
	}
}

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
