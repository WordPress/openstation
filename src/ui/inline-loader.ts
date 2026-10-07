import { __ } from '../i18n';

export const SHOW_DELAY_MS = 120;

const ROOT_CLASS = 'os-inline-loader';

const KEYFRAMES_ID = 'os-inline-loader-keyframes';

export interface InlineLoaderOptions {

	label?: string;

	immediate?: boolean;
}

export interface InlineLoader {

	done: () => void;

	fail: ( message: string, retry?: () => void ) => void;
}

function spinnerWillUpgrade(): boolean {
	return (
		typeof customElements !== 'undefined' &&
		!! customElements.get( 'os-spinner' )
	);
}

function ensureKeyframes(): void {
	if ( document.getElementById( KEYFRAMES_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = KEYFRAMES_ID;
	style.textContent =
		'@keyframes os-inline-loader-spin{to{transform:rotate(360deg)}}';
	document.head.appendChild( style );
}

export function buildLoadingSpinner(): HTMLElement {
	if ( spinnerWillUpgrade() ) {
		const spinner = document.createElement( 'os-spinner' );

		spinner.setAttribute( 'preset', 'inline' );
		spinner.setAttribute( 'size', '20' );

		spinner.setAttribute( 'aria-hidden', 'true' );
		return spinner;
	}

	const arc = document.createElement( 'span' );
	arc.setAttribute( 'aria-hidden', 'true' );
	arc.style.cssText = [
		'flex:0 0 auto',
		'width:16px',
		'height:16px',
		'border-radius:50%',
		'border:2px solid currentColor',
		'border-top-color:transparent',
		'opacity:0.7',
	].join( ';' );
	const reduceMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	if ( ! reduceMotion ) {
		ensureKeyframes();
		arc.style.animation = 'os-inline-loader-spin 0.7s linear infinite';
	}
	return arc;
}

export function showInlineLoader(
	container: HTMLElement,
	options: InlineLoaderOptions = {},
): InlineLoader {
	const label = options.label ?? __( 'Loading…' );
	let root: HTMLElement | null = null;
	let settled = false;

	const paint = (): void => {
		if ( settled || root || ! container.isConnected ) {
			return;
		}
		root = document.createElement( 'div' );
		root.className = ROOT_CLASS;

		root.setAttribute( 'role', 'status' );
		root.setAttribute( 'aria-live', 'polite' );
		root.style.cssText = [
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'gap:10px',
			'padding:20px 16px',
			'font-size:13px',
			'color:var(--os-ui-fg-muted,#646970)',
		].join( ';' );

		const text = document.createElement( 'span' );
		text.textContent = label;

		root.appendChild( buildLoadingSpinner() );
		root.appendChild( text );
		container.appendChild( root );
	};

	const timer = options.immediate
		? null
		: window.setTimeout( paint, SHOW_DELAY_MS );
	if ( options.immediate ) {
		paint();
	}

	const clearTimer = (): void => {
		if ( null !== timer ) {
			window.clearTimeout( timer );
		}
	};

	return {
		done: () => {
			if ( settled ) {
				return;
			}
			settled = true;
			clearTimer();
			root?.remove();
			root = null;
		},
		fail: ( message: string, retry?: () => void ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			clearTimer();

			if ( ! root ) {
				settled = false;
				paint();
				settled = true;
			}
			if ( ! root ) {
				return;
			}
			root.textContent = '';

			root.setAttribute( 'aria-live', 'assertive' );
			root.style.flexDirection = 'column';
			root.style.color = 'var(--os-ui-fg-muted,#646970)';

			const text = document.createElement( 'span' );
			text.textContent = message;
			root.appendChild( text );

			if ( retry ) {
				const button = document.createElement( 'button' );
				button.type = 'button';
				button.textContent = __( 'Retry' );
				button.className = 'button button-small';
				button.addEventListener( 'click', () => {
					root?.remove();
					root = null;
					settled = false;
					retry();
				} );
				root.appendChild( button );
			}
		},
	};
}
