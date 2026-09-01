/**
 * My WordPress — pure client helpers.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. This part owns the LOGIC the tests pin
 * hardest: page accumulation, selection math, preview-action scoping
 * through the shared WP Explorer filter, and the context-menu option
 * builders. Everything here is a pure function of its inputs.
 *
 * @public
 */

import { __, html, type TemplateResult } from '@openstation/app';
import {
	type AppData,
	type ListBanding,
	type AppState,
	type ListItem,
	type MenuOption,
	type OsShell,
	type PreviewAction,
	type PreviewActionContext,
	type SectionDef,
} from './types';

/** The identity of a list: new key, new accumulation. */
export function listKey( state: AppState ): string {
	return [ state.section, state.query, state.sort ].join( '|' );
}

/**
 * Which preview actions apply to an item — section/post-type/MIME
 * scoping, then the shared `os.my-wordpress.preview-actions` JS
 * filter, exactly as WP Explorer resolves them.
 */
export function resolveActions(
	descriptors: PreviewAction[],
	ctx: PreviewActionContext,
	applyFilters?: OsShell[ 'hooks' ],
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
			if ( ! ctx.mime ) {
				return false;
			}
			try {
				if ( ! new RegExp( a.mime ).test( ctx.mime ) ) {
					return false;
				}
			} catch {
				return false;
			}
		}
		return true;
	} );
	const merged = applyFilters?.applyFilters( 'os.my-wordpress.preview-actions', scoped, ctx );
	return Array.isArray( merged ) ? ( merged as PreviewAction[] ) : scoped;
}

export function actionContext(
	section: SectionDef,
	item: ListItem,
	surface: 'pane' | 'menu',
): PreviewActionContext {
	return {
		entityId: section.id,
		kind: section.kind,
		postType: section.post_type,
		mime: item.mime || undefined,
		item: item as unknown as Record< string, unknown >,
		itemId: item.id,
		surface,
	};
}

export function runAction( action: PreviewAction, ctx: PreviewActionContext ): void {
	try {
		action.onSelect?.( ctx );
	} catch {
		// Plugin code — contained.
		// eslint-disable-next-line no-console
		console.error( `[my-wordpress] preview action ${ action.id } threw.` );
	}
}

export function sectionOf( data: AppData, id: string ): SectionDef | null {
	return data.sections.find( ( s ) => s.id === id ) ?? null;
}

/**
 * Resolve the banding for a section through WP Explorer's own
 * `os.my-wordpress.list-bands` filter, or null when its tiles should
 * render as one flat canvas — the default for every built-in section.
 * The section descriptor plays the entity's role (same `id`, `kind`,
 * `post_type` keys the subscribers read).
 */
export function resolveBanding(
	hooks: OsShell[ 'hooks' ],
	section: SectionDef,
): ListBanding | null {
	const banding = hooks?.applyFilters( 'os.my-wordpress.list-bands', null, section ) as
		| ListBanding
		| null;
	if (
		! banding ||
		! Array.isArray( banding.bands ) ||
		banding.bands.length === 0 ||
		typeof banding.assign !== 'function'
	) {
		return null;
	}
	return banding;
}

export function glyph( icon: string, cls: string ): TemplateResult {
	if ( icon.startsWith( 'dashicons-' ) ) {
		return html`<span class="${ cls } dashicons ${ icon }" aria-hidden="true"></span>`;
	}
	// Image icons are MASKED to the current text colour, the way the
	// shell's renderIcon() paints them — a plugin's brand SVG (Woo's
	// black W) must not break the monochrome tile family.
	return html`<span
		class="${ cls } os-mywp__icon-mask"
		style="--mywp-icon:url(&quot;${ icon.replace( /"/g, '%22' ) }&quot;)"
		aria-hidden="true"
	></span>`;
}

/**
 * Group the agents' "Send to …" rows behind an inert `Send to`
 * heading. The shared filter appends plugin entries after our base
 * options; the agent block is recognised by its id prefix
 * (`agent-send-to-<id>`, the contract `agents-send-to.ts` ships) so
 * other plugins' entries stay where the filter put them.
 */
export function withSendToHeading( base: MenuOption[], merged: MenuOption[] ): MenuOption[] {
	if ( merged.length <= base.length || ! base.every( ( o, i ) => merged[ i ]?.id === o.id ) ) {
		// The filter reordered or replaced — respect it verbatim.
		return merged;
	}
	const appended = merged.slice( base.length );
	const agents = appended.filter( ( o ) => o.id.startsWith( 'agent-send-to-' ) );
	if ( agents.length === 0 ) {
		return merged;
	}
	const others = appended.filter( ( o ) => ! o.id.startsWith( 'agent-send-to-' ) );
	return [
		...merged.slice( 0, base.length ),
		...others,
		{ id: 'send-to-heading', label: __( 'Send to' ), heading: true },
		...agents,
	];
}

/**
 * The base context menu for one item, in WP Explorer's order: Open in
 * editor, Navigate into, Edit…, Publish, Copy link, Move to Trash —
 * then the item's preview actions. Plugin entries (the agents'
 * "Send to …" rows among them) are appended afterwards by the shared
 * `os.my-wordpress.tile-context-menu` filter, exactly as they are in
 * WP Explorer.
 */
export function buildMenuOptions(
	section: SectionDef,
	item: ListItem,
	previewActions: PreviewAction[],
): MenuOption[] {
	const options: MenuOption[] = [];
	if ( item.canEdit ) {
		options.push( {
			id: 'edit',
			label: section.kind === 'user' ? __( 'Edit profile' ) : __( 'Open in editor' ),
		} );
	}
	options.push( { id: 'open', label: __( 'Navigate into' ) } );
	// A flat section's rows are not posts — no quick-edit, no
	// publish, no trash. The plugin seam below still appends its own
	// entries (Woo's orders get nothing extra; its customers do).
	if ( section.kind === 'post' && item.canEdit && ! section.flat ) {
		options.push( { id: 'quick-edit', label: __( 'Edit…' ) } );
		if ( item.status !== 'publish' ) {
			options.push( { id: 'publish', label: __( 'Publish' ) } );
		}
	}
	if ( item.link ) {
		options.push( { id: 'copy-link', label: __( 'Copy link' ) } );
	}
	if ( section.kind === 'post' && ! section.flat ) {
		options.push( {
			id: 'trash',
			label: __( 'Move to Trash' ),
			danger: true,
			disabled: ! item.canDelete,
		} );
	}
	for ( const action of previewActions ) {
		options.push( { id: action.id, label: action.label, icon: action.icon } );
	}
	return options;
}
