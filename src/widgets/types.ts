export type WidgetTeardown = () => void;

export interface WidgetStorage {

	get< T = unknown >( key: string ): T | null;

	set< T = unknown >( key: string, value: T ): void;

	remove( key: string ): void;

	clear(): void;
}

export interface WidgetContext {

	id: string;

	pluginUrl: string;

	storage: WidgetStorage;
}

export interface WidgetDef {

	id: string;

	label: string;

	description: string;

	icon: string;

	movable?: boolean;

	resizable?: boolean;

	minWidth?: number;

	minHeight?: number;

	maxWidth?: number;

	maxHeight?: number;

	defaultWidth?: number;
	defaultHeight?: number;

	mount: (
		container: HTMLElement,
		ctx: WidgetContext,
	) => WidgetTeardown | Promise<WidgetTeardown>;
}

export interface WidgetGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}
