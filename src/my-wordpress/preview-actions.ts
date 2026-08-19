/**
 * My WordPress — preview actions, the one pipeline.
 *
 * Server descriptors collected via the PHP filter
 * `openstation_my_wordpress_preview_actions` become buttons in the
 * right pane and entries in the tile context menu — in every section,
 * whatever its render kind. This module owns the whole client side of
 * that contract: section/MIME scoping, the
 * `os.my-wordpress.preview-actions` JS filter, and the button/menu
 * builders each surface calls.
 *
 * A descriptor's `sections` list matches the section **id**
 * (`'media'`, `'cpt-atf-forms'`), the section's declared **post type
 * slug** (`'atf-forms'`), or `'*'` for every section. Plugin authors
 * know their post type; the `cpt-` id prefix is our derivation — both
 * spellings work so neither has to be looked up.
 *
 * @public
 */

import { applyFilters } from '../hooks';
import { getConfig } from './rest';
import type {
	MyWordPressEntity,
	PreviewAction,
	PreviewActionContext,
	PreviewActionSurface,
} from './types';

/**
 * Build the context handed to `onSelect` / `isVisible` and the JS
 * filter for an item selected in the given section.
 *
 * @public
 */
export function buildPreviewActionContext(
	entity: MyWordPressEntity,
	item: Record< string, unknown >,
	opts: { surface: PreviewActionSurface; mime?: string } = { surface: 'pane' },
): PreviewActionContext {
	const id = Number( item.id );
	return {
		entityId: entity.id,
		kind: entity.kind ?? 'post',
		postType: entity.post_type,
		mime: opts.mime,
		item,
		itemId: Number.isFinite( id ) ? id : undefined,
		surface: opts.surface,
	};
}

/**
 * Resolve which action descriptors apply to the given context and
 * call the JS-filter so plugins can attach handlers / hide entries.
 *
 * @public
 */
export function resolvePreviewActions(
	descriptors: PreviewAction[],
	ctx: PreviewActionContext,
): PreviewAction[] {
	const scoped = descriptors.filter( ( a ) => {
		if ( a.sections && a.sections.length > 0 ) {
			const matches =
				a.sections.includes( ctx.entityId ) ||
				a.sections.includes( '*' ) ||
				( !! ctx.postType && a.sections.includes( ctx.postType ) );
			if ( ! matches ) {
				return false;
			}
		}
		if ( a.mime ) {
			// MIME-scoped descriptor: fail closed on the
			// non-media-context call site so a `^image/` action
			// doesn't leak into a Posts preview pane.
			if ( ! ctx.mime ) {
				return false;
			}
			try {
				const re = new RegExp( a.mime );
				if ( ! re.test( ctx.mime ) ) {
					return false;
				}
			} catch {
				// Malformed regex from PHP — skip the action.
				return false;
			}
		}
		return true;
	} );
	const merged = applyFilters<
		PreviewAction[],
		[ PreviewActionContext ]
	>( 'os.my-wordpress.preview-actions', scoped, ctx );
	return Array.isArray( merged ) ? merged : scoped;
}

/**
 * Invoke a preview action's handler, swallowing plugin-code throws.
 *
 * @public
 */
export function runPreviewAction(
	action: PreviewAction,
	ctx: PreviewActionContext,
): void {
	if ( typeof action.onSelect !== 'function' ) {
		return;
	}
	try {
		void action.onSelect( ctx );
	} catch {
		// Handler is plugin code — log via console only.
		// eslint-disable-next-line no-console
		console.error(
			`[my-wordpress] preview action ${ action.id } threw.`,
		);
	}
}

/**
 * Drop the action a section named as its `editAction` — it renders
 * as the section's edit affordance instead of a generic row/menu
 * entry, and rendering it in both places would be a duplicate.
 *
 * @public
 */
export function withoutEditAction(
	entity: MyWordPressEntity,
	actions: PreviewAction[],
): PreviewAction[] {
	return typeof entity.editAction === 'string'
		? actions.filter( ( a ) => a.id !== entity.editAction )
		: actions;
}

/**
 * What "edit this row" means for a section — see
 * `MyWordPressEntity.editAction`.
 *
 * @public
 */
export type EditActionResolution =
	| { mode: 'classic' }
	| { mode: 'none' }
	| { mode: 'action'; action: PreviewAction; ctx: PreviewActionContext };

/**
 * Resolve the section's edit affordance for one item.
 *
 * `'classic'` — no declaration; the classic-editor URL applies.
 * `'none'`   — editing is off: declared `false`, or the named action
 *              is unavailable (dropped server-side, no `onSelect`
 *              wired, or `isVisible` said no) — the classic URL is
 *              known-broken for such a section, so hiding beats a
 *              button that 404s.
 * `'action'` — the named action, resolved through the full pipeline,
 *              with the ctx to invoke it with.
 *
 * @public
 */
export function resolveEditAction(
	entity: MyWordPressEntity,
	item: Record< string, unknown >,
	surface: PreviewActionSurface,
): EditActionResolution {
	if ( entity.editAction === undefined ) {
		return { mode: 'classic' };
	}
	if ( entity.editAction === false ) {
		return { mode: 'none' };
	}
	const ctx = buildPreviewActionContext( entity, item, { surface } );
	const action = resolvePreviewActions(
		getConfig().previewActions ?? [],
		ctx,
	).find( ( a ) => a.id === entity.editAction );
	if (
		! action ||
		typeof action.onSelect !== 'function' ||
		( typeof action.isVisible === 'function' && ! action.isVisible( ctx ) )
	) {
		return { mode: 'none' };
	}
	return { mode: 'action', action, ctx };
}

/**
 * Append one `<os-button>` per visible action to `container`.
 * Returns the number of buttons appended, so a caller that owns the
 * container (the post pane's footer) can skip separators when zero.
 *
 * @public
 */
export function appendActionButtons(
	container: HTMLElement,
	actions: PreviewAction[],
	ctx: PreviewActionContext,
): number {
	const visible = actions.filter( ( a ) =>
		typeof a.isVisible === 'function' ? a.isVisible( ctx ) : true,
	);
	for ( const action of visible ) {
		const btn = document.createElement( 'os-button' );
		btn.setAttribute( 'variant', 'secondary' );
		btn.dataset.actionId = action.id;
		if ( action.icon ) {
			btn.setAttribute( 'icon', action.icon );
		}
		btn.textContent = action.label;
		btn.addEventListener( 'click', () =>
			runPreviewAction( action, ctx ),
		);
		container.appendChild( btn );
	}
	return visible.length;
}

/**
 * Wrap the visible actions in the standalone toolbar row the media
 * pane renders, or null when none apply.
 *
 * @public
 */
export function buildActionRow(
	actions: PreviewAction[],
	ctx: PreviewActionContext,
): HTMLElement | null {
	const row = document.createElement( 'div' );
	row.className = 'os-my-wordpress__media-actions';
	row.setAttribute( 'role', 'toolbar' );
	return appendActionButtons( row, actions, ctx ) > 0 ? row : null;
}

/**
 * One-call convenience for section renderers (built-in and custom
 * kinds): resolve the window config's descriptors against this
 * section + item and return the ready action row, or null.
 *
 * @public
 */
export function buildPreviewActionRow(
	entity: MyWordPressEntity,
	item: Record< string, unknown >,
	opts: { surface?: PreviewActionSurface; mime?: string } = {},
): HTMLElement | null {
	const ctx = buildPreviewActionContext( entity, item, {
		surface: opts.surface ?? 'pane',
		mime: opts.mime,
	} );
	const resolved = withoutEditAction(
		entity,
		resolvePreviewActions( getConfig().previewActions ?? [], ctx ),
	);
	return buildActionRow( resolved, ctx );
}

/**
 * A context-menu entry derived from a preview-action descriptor.
 * Structurally a `TileMenuOption` minus the built-in-only fields, so
 * the menu builders can splice these straight into their base list
 * before the `os.my-wordpress.tile-context-menu` filter runs.
 *
 * @public
 */
export interface PreviewActionMenuOption {
	id: string;
	label: string;
	icon: string;
	sort: number;
	onSelect: () => void;
}

/**
 * Sort slot for descriptor-derived menu entries: after the built-in
 * navigation entries (10/20), before destructive ones (90).
 */
const MENU_SORT = 50;

/**
 * Map the section's applicable descriptors to context-menu entries.
 * The zero-arg menu `onSelect` closes over the ctx-carrying handler.
 *
 * @public
 */
export function previewActionsToMenuOptions(
	entity: MyWordPressEntity,
	item: Record< string, unknown >,
	opts: { mime?: string } = {},
): PreviewActionMenuOption[] {
	const ctx = buildPreviewActionContext( entity, item, {
		surface: 'context-menu',
		mime: opts.mime,
	} );
	const resolved = withoutEditAction(
		entity,
		resolvePreviewActions( getConfig().previewActions ?? [], ctx ),
	);
	return resolved
		.filter( ( a ) =>
			typeof a.isVisible === 'function' ? a.isVisible( ctx ) : true,
		)
		.map( ( action ) => ( {
			id: action.id,
			label: action.label,
			icon: action.icon ?? 'dashicons-admin-generic',
			sort: MENU_SORT,
			onSelect: () => runPreviewAction( action, ctx ),
		} ) );
}
