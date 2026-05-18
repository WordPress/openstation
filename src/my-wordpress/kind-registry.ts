/**
 * My WordPress — entity-kind renderer registry.
 *
 * The window's `navigate()` switch used to hardcode the three
 * in-tree kinds (`post`, `user`, `media`). The registry decouples
 * the dispatch from the bundle: third-party plugins can ship their
 * own section type by calling
 * `wp.desktop.myWordpress.registerEntityKind(kind, renderer)`
 * before (or after) the window mounts, and the dispatcher will
 * find it.
 *
 * Renderers receive an opaque host object that exposes the public
 * `navigate` / `state` surface they need — internal types stay
 * private to `index.ts`.
 *
 * @public
 * @since 0.21.0
 */

import type { MyWordPressEntity, Route } from './types';

/**
 * Surface passed to every renderer. The renderer paints into
 * `body` and may call `navigate` to move the window to another
 * route.
 *
 * @public
 * @since 0.21.0
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
}

/**
 * Renderer callback signature. Receives the host + the entity
 * descriptor whose section is being entered.
 *
 * @public
 * @since 0.21.0
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
 * @since 0.21.0
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
 * @since 0.21.0
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
 * @since 0.21.0
 */
export function listRegisteredKinds(): string[] {
	return Array.from( renderers.keys() );
}
