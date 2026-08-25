/**
 * My WordPress — entity-kind renderer registry.
 *
 * The window's `navigate()` switch used to hardcode the three
 * in-tree kinds (`post`, `user`, `media`). The registry decouples
 * the dispatch from the bundle: third-party plugins can ship their
 * own section type by calling
 * `wp.os.myWordpress.registerEntityKind(kind, renderer)`
 * before (or after) the window mounts, and the dispatcher will
 * find it.
 *
 * Renderers receive an opaque host object that exposes the public
 * `navigate` / `state` surface they need — internal types stay
 * private to `index.ts`.
 *
 * @public
 */

import type {
	MyWordPressEntity,
	PreviewActionSurface,
	Route,
} from './types';

/**
 * Surface passed to every renderer. The renderer paints into
 * `body` and may call `navigate` to move the window to another
 * route.
 *
 * @public
 */
export interface EntityRenderHost {
	/** The window body element the renderer should paint into. */
	body: HTMLElement;
	/** Active route at render time. */
	route: Route;
	/**
	 * Navigate the window to a new route. The host owns history
	 * and breadcrumb chrome — renderers only paint inside `body`.
	 */
	navigate: ( route: Route ) => void;
	/**
	 * Push a tear-down callback fired when the window is closed or
	 * the user navigates away. Renderers MUST use this for any
	 * subscription / observer / timer they create.
	 */
	addTeardown: ( fn: () => void ) => void;
	/**
	 * Resolve the section's server-declared preview actions
	 * (`openstation_my_wordpress_preview_actions`) against one item
	 * and return the same ready-made action row the built-in panes
	 * render — or null when none apply. Runs the
	 * `os.my-wordpress.preview-actions` JS filter, so a custom-kind
	 * renderer gets the whole pipeline from one call.
	 */
	previewActionRow: ( args: {
		/** The selected item, as the server sent it. */
		item: Record< string, unknown >;
		/** MIME type, when the item is a media file. */
		mime?: string;
		/** Invocation surface. Default `'pane'`. */
		surface?: PreviewActionSurface;
	} ) => HTMLElement | null;
}

/**
 * Renderer callback signature. Receives the host + the entity
 * descriptor whose section is being entered.
 *
 * @public
 */
export type EntityRenderer = (
	host: EntityRenderHost,
	entity: MyWordPressEntity,
) => void;

const renderers = new Map< string, EntityRenderer >();

/**
 * Register a renderer for a given entity kind. The latest call
 * wins — plugins re-registering an in-tree kind override the
 * default, by design.
 *
 * @public
 *
 * @param kind     Entity kind slug (`'post'`, `'user'`, plugin slug).
 * @param renderer Render callback.
 * @return Unregister function — calling it removes ONLY this
 *         renderer (the registry then falls back to nothing for
 *         the kind).
 */
export function registerEntityKind(
	kind: string,
	renderer: EntityRenderer,
): () => void {
	if ( typeof kind !== 'string' || kind === '' ) {
		throw new TypeError(
			'[my-wordpress] registerEntityKind: kind must be a non-empty string.',
		);
	}
	if ( typeof renderer !== 'function' ) {
		throw new TypeError(
			'[my-wordpress] registerEntityKind: renderer must be a function.',
		);
	}
	renderers.set( kind, renderer );
	return () => {
		if ( renderers.get( kind ) === renderer ) {
			renderers.delete( kind );
		}
	};
}

/**
 * Look up the renderer for a given kind. Returns `undefined` when
 * no renderer is registered — the dispatcher in `index.ts` paints
 * a generic "unknown kind" error in that case.
 *
 * @public
 */
export function getEntityRenderer(
	kind: string | undefined,
): EntityRenderer | undefined {
	if ( ! kind ) {
		return renderers.get( 'post' );
	}
	return renderers.get( kind );
}

/**
 * Snapshot of registered kinds — diagnostics only.
 *
 * @public
 */
export function listRegisteredKinds(): string[] {
	return Array.from( renderers.keys() );
}
