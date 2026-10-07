import type { WindowState } from '../types';

export interface RelatedEntityItem {

	id: string;

	group: string;

	groupLabel?: string;

	label: string;

	icon?: string;

	url?: string;

	windowId?: string;

	params?: Record< string, string | number | boolean >;

	count?: number;
}

export interface WindowContentRef {

	type: string;

	id: number | string;

	root?: {
		type: string;
		id: number | string;
	};

	links?: Array< {
		type: string;
		id: number | string;
		rel?: 'references' | 'child';
	} >;

	label?: string;

	related?: RelatedEntityItem[];

	previewUrl?: string;

	revisionsUrl?: string;

	revisionCount?: number;

	source?: 'config' | 'bridge' | 'api';
}

export interface WindowLinkGroup {

	key: string;

	root: {
		type: string;
		id: number | string;
	};

	rootWindowIds: string[];

	children: Array< {
		windowId: string;
		content: WindowContentRef;
	} >;
}

export interface WindowLinkEdge {
	fromWindowId: string;
	toWindowId: string;
	kind: 'child-root' | 'reference';
	bidirectional: boolean;
}

export interface WindowLinkFrame {
	groups: Array< {
		key: string;
		root: WindowLinkGroup[ 'root' ];
		members: Array< {
			windowId: string;
			role: 'root' | 'child';
			content: WindowContentRef;

			rect: {
				x: number;
				y: number;
				width: number;
				height: number;
			} | null;
			focused: boolean;
			state: WindowState;
		} >;
	} >;

	edges: Array< {
		fromWindowId: string;
		toWindowId: string;
		kind: WindowLinkEdge[ 'kind' ];
		bidirectional: boolean;

		focused: boolean;
		from: { x: number; y: number; width: number; height: number } | null;
		to: { x: number; y: number; width: number; height: number } | null;

		fromZIndex: number | null;
		toZIndex: number | null;

		elevated: boolean;
	} >;

	obstacles: Array< {
		windowId: string;
		rect: { x: number; y: number; width: number; height: number };
		zIndex: number;
	} >;

	container: {
		width: number;
		height: number;
	};
}

export interface WindowLinkRendererContext {

	container: HTMLElement;

	elevatedContainer: HTMLElement;

	getFrame: () => WindowLinkFrame;

	onFrame: ( cb: ( frame: WindowLinkFrame ) => void ) => () => void;
}

export interface WindowLinkRendererDef {

	id: string;

	label: string;

	description?: string;

	mount: (
		ctx: WindowLinkRendererContext,
	) => void | ( () => void ) | Promise< void | ( () => void ) >;

	owner?: string;
}

export interface WindowRelationsApi {

	get: ( windowId: string ) => WindowContentRef | undefined;

	set: ( windowId: string, ref: WindowContentRef | null ) => void;

	groups: () => WindowLinkGroup[];

	edges: () => WindowLinkEdge[];

	groupOf: ( windowId: string ) => WindowLinkGroup | undefined;

	related: ( windowId: string ) => string[];

	subscribe: ( cb: () => void ) => () => void;
}
