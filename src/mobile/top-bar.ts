/**
 * OpenStation — phone layer: the top bar.
 *
 * One bar for the whole shell, not one per window: it mirrors the
 * focused window (icon, title) and offers exactly one control, a ×
 * that closes the app. Going home is not a button here — a phone
 * keeps that in the system: the tab bar's Home, the edge swipe, the
 * hardware Back. The window's own title bar stays in the DOM, hidden
 * by `mobile.css`, so every desktop listener bound to it keeps
 * working.
 */
import { __ } from '../i18n';
import { osIcon } from '../ui/icons';

export interface TopBarInfo {
	title: string;
	icon: string;
}

export interface TopBarDeps {
	renderIcon: ( icon: string, opts: { title: string; className?: string } ) => HTMLElement;
	/** Send the app to the background (home, window kept). */
	onMinimize: () => void;
	/** Close the app the bar is showing. */
	onClose: () => void;
}

export interface TopBarSurface {
	el: HTMLElement;
	update( info: TopBarInfo | null ): void;
	setHidden( hidden: boolean ): void;
	/** The 0..1 progress of an in-flight back gesture, for the hint. */
	setBackProgress( progress: number ): void;
}

export function createTopBar( host: HTMLElement, deps: TopBarDeps ): TopBarSurface {
	const el = document.createElement( 'header' );
	el.className = 'os-mobile-top';
	el.hidden = true;

	const identity = document.createElement( 'div' );
	identity.className = 'os-mobile-top__identity';

	const icon = document.createElement( 'span' );
	icon.className = 'os-mobile-top__icon';
	icon.setAttribute( 'aria-hidden', 'true' );

	const title = document.createElement( 'h1' );
	title.className = 'os-mobile-top__title';

	identity.append( icon, title );

	const controls = document.createElement( 'div' );
	controls.className = 'os-mobile-top__controls';

	// Minimize: the app goes to the background and its window stays
	// alive in the switcher — the phone's "home" from inside the app.
	const minimize = document.createElement( 'button' );
	minimize.type = 'button';
	minimize.className = 'os-mobile-top__button os-mobile-top__minimize';
	minimize.setAttribute( 'aria-label', __( 'Minimize app' ) );
	minimize.appendChild( osIcon( 'minimize', { size: 20 } ) );
	minimize.addEventListener( 'click', deps.onMinimize );

	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'os-mobile-top__button os-mobile-top__close';
	close.setAttribute( 'aria-label', __( 'Close app' ) );
	close.appendChild( osIcon( 'close', { size: 20 } ) );
	close.addEventListener( 'click', deps.onClose );

	controls.append( minimize, close );
	el.append( identity, controls );
	host.appendChild( el );

	let lastIcon = '';

	return {
		el,
		update( info ) {
			if ( ! info ) {
				title.textContent = '';
				icon.replaceChildren();
				lastIcon = '';
				return;
			}
			if ( title.textContent !== info.title ) {
				title.textContent = info.title;
			}
			if ( info.icon !== lastIcon ) {
				lastIcon = info.icon;
				icon.replaceChildren(
					deps.renderIcon( info.icon, { title: info.title, className: 'os-mobile-top__glyph' } ),
				);
			}
		},
		setHidden( hidden ) {
			el.hidden = hidden;
		},
		setBackProgress( progress ) {
			el.style.setProperty( '--os-mobile-back-progress', String( progress ) );
			el.classList.toggle( 'os-mobile-top--peeking', progress > 0 );
		},
	};
}
