import { __, html, type TemplateResult } from '@openstation/app';
import { isMobileStamped } from '../../../src/mode/stamp';
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

export function opensOnTap( root: Element | null = null ): boolean {
	const el = root ?? ( typeof document !== 'undefined' ? document.documentElement : null );
	if ( el && isMobileStamped( el ) ) {
		return true;
	}
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(pointer: coarse)' ).matches
	);
}

export function listKey( state: AppState ): string {
	return [ state.section, state.query, state.sort ].join( '|' );
}

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
		console.error( `[my-wordpress] preview action ${ action.id } threw.` );
	}
}

export function sectionOf( data: AppData, id: string ): SectionDef | null {
	return data.sections.find( ( s ) => s.id === id ) ?? null;
}

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

	return html`<span
		class="${ cls } os-mywp__icon-mask"
		style="--mywp-icon:url(&quot;${ icon.replace( /"/g, '%22' ) }&quot;)"
		aria-hidden="true"
	></span>`;
}

export function withSendToHeading( base: MenuOption[], merged: MenuOption[] ): MenuOption[] {
	if ( merged.length <= base.length || ! base.every( ( o, i ) => merged[ i ]?.id === o.id ) ) {
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

	if ( section.kind === 'post' && item.canEdit && ! section.flat ) {
		options.push( { id: 'quick-edit', label: __( 'Edit…' ) } );
		if ( item.status !== 'publish' ) {
			options.push( { id: 'publish', label: __( 'Publish' ) } );
		}
	}
	if ( item.link ) {
		options.push( { id: 'copy-link', label: __( 'Copy link' ) } );
	}

	if ( item.shortlink ) {
		options.push( { id: 'copy-shortlink', label: __( 'Copy shortlink' ) } );
	}
	options.push( { id: 'copy-id', label: __( 'Copy ID' ) } );
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
