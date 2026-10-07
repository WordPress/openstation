import { doAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { showToast } from '../toast';
import {
	ensureFullDesktopThemes,
	getDesktopTheme,
	getStore,
} from './registry';
import type { DesktopThemeEntry } from './types';

const LINK_ID = 'os-desktop-theme-css';

const INLINE_ID = 'os-desktop-theme-inline-css';

const OWNED_ATTR = 'data-os-desktop-theme-css';

export const DESKTOP_THEME_CHANGED_EVENT = 'os-desktop-theme-changed';

export interface DesktopThemeChangedDetail {
	themeId: string | null;
	previous: string | null;
}

function shellRoot(): HTMLElement | null {
	return document.getElementById( 'os-shell' );
}

function styleElements(): HTMLElement[] {
	const found: HTMLElement[] = [];
	for ( const id of [ LINK_ID, INLINE_ID ] ) {
		const el = document.getElementById( id );
		if ( el ) {
			found.push( el );
		}
	}
	document.querySelectorAll< HTMLElement >( `[${ OWNED_ATTR }]` ).forEach(
		( el ) => {
			if ( ! found.includes( el ) ) {
				found.push( el );
			}
		},
	);
	return found;
}

function removeStyleElements(): void {
	for ( const el of styleElements() ) {
		el.remove();
	}
}

function bootAlreadyApplied( slug: string ): boolean {
	const shell = shellRoot();
	if ( ! shell ) {
		return false;
	}
	if ( shell.getAttribute( 'data-os-desktop-theme' ) !== slug ) {
		return false;
	}
	return styleElements().length > 0;
}

function injectThemeStylesheet( theme: DesktopThemeEntry ): void {
	if ( theme.cssUrl !== '' ) {
		const link = document.createElement( 'link' );
		link.id = LINK_ID;
		link.rel = 'stylesheet';
		link.href = theme.cssUrl;
		link.setAttribute( OWNED_ATTR, theme.slug );
		document.head.appendChild( link );
	} else if ( theme.cssText !== '' ) {
		const style = document.createElement( 'style' );
		style.setAttribute( OWNED_ATTR, theme.slug );
		style.textContent = theme.cssText;
		document.head.appendChild( style );
	}
}

function applyBodyClass( slug: string | null ): void {
	const body = document.body;
	if ( ! body ) {
		return;
	}
	const stale: string[] = [];
	body.classList.forEach( ( name ) => {
		if ( name.startsWith( 'os-desktop-theme-' ) ) {
			stale.push( name );
		}
	} );
	for ( const name of stale ) {
		if ( slug === null || name !== `os-desktop-theme-${ slug }` ) {
			body.classList.remove( name );
		}
	}
	if ( slug !== null ) {
		body.classList.add( `os-desktop-theme-${ slug }` );
	}
}

export function applyDesktopTheme( themeId: string | null | undefined ): void {
	const store = getStore();
	const previous = store.state.activeId;

	const requested = typeof themeId === 'string' ? themeId.trim() : '';
	const theme = requested === '' ? null : getDesktopTheme( requested );

	const nextId = theme ? theme.slug : null;

	if ( nextId === previous ) {
		return;
	}

	const shell = shellRoot();

	if ( ! theme ) {
		shell?.removeAttribute( 'data-os-desktop-theme' );
		applyBodyClass( null );
		removeStyleElements();
		store.setState( {
			activeId: null,
			activeIcons: null,
			activeIconColors: null,
		} );
	} else {
		if ( ! bootAlreadyApplied( theme.slug ) ) {
			if (
				theme.cssDeferred &&
				theme.cssUrl === '' &&
				theme.cssText === ''
			) {
				const slug = theme.slug;
				const loadAndInject = (): Promise< void > =>
					ensureFullDesktopThemes()
						.then( () => {
							if ( getStore().state.activeId !== slug ) {
								return;
							}
							const full = getDesktopTheme( slug );
							if ( ! full || full.cssDeferred ) {
								throw new Error(
									`theme "${ slug }" resolved without a stylesheet`,
								);
							}
							removeStyleElements();
							injectThemeStylesheet( full );
						} )
						.catch( ( err ) => {
							if ( getStore().state.activeId !== slug ) {
								return;
							}
							showToast( {
								message: __(
									'Could not load that desktop theme — the previous one is still showing.',
								),
								action: {
									label: __( 'Retry' ),
									onClick: () => void loadAndInject(),
								},
								persistent: true,
								dismissible: true,
							} );

							console.warn(
								'[openstation] desktop theme stylesheet failed to load',
								err,
							);
						} );
				void loadAndInject();
			} else {
				removeStyleElements();
				injectThemeStylesheet( theme );
			}
		}
		shell?.setAttribute( 'data-os-desktop-theme', theme.slug );
		applyBodyClass( theme.slug );
		store.setState( {
			activeId: theme.slug,

			activeIcons: theme.icons,
			activeIconColors: theme.iconColors,
		} );
	}

	const detail: DesktopThemeChangedDetail = {
		themeId: nextId,
		previous,
	};
	doAction( HOOKS.DESKTOP_THEME_CHANGED, detail );
	if ( typeof document !== 'undefined' ) {
		document.dispatchEvent(
			new CustomEvent< DesktopThemeChangedDetail >(
				DESKTOP_THEME_CHANGED_EVENT,
				{ detail },
			),
		);
	}
}
