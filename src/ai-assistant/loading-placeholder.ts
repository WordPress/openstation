/**
 * OpenStation — first-open placeholder for the command palette.
 *
 * The palette is lazy in three separate ways, and the first ⌘K of a
 * session pays for all of them at once: the implementation bundle
 * (`ai-assistant.min.js`), its stylesheet (a `deferredStyles` entry),
 * and the Core command-palette runtime the manifest replays. Until
 * those land, pressing ⌘K used to do nothing visible at all — the
 * shell looked like it had ignored the keystroke, which is the exact
 * moment a user presses it again.
 *
 * So we paint a placeholder immediately, in the position the panel is
 * about to occupy, and swap it for the real thing when it arrives.
 *
 * **Everything here is inline-styled on purpose.** `ai-assistant.css`
 * is itself deferred — it is being fetched in parallel with this very
 * placeholder — so a class-based skeleton would render unstyled for
 * precisely the window of time the placeholder exists to cover. The
 * geometry below deliberately mirrors `.os-ai` / `.os-ai__panel` in
 * `assets/css/ai-assistant.css`: same `clamp()` offset from the top,
 * same 600px cap, same radius. When the panel replaces it, it lands
 * where the placeholder already was.
 *
 * **And the spinner is hand-rolled rather than `<os-spinner>`,** which
 * is a real exception to the "default to an `os-*` component" rule in
 * AGENTS.md and needs its reason on the record. The objection is not
 * the component's styles — those live in its own shadow root and would
 * be fine. It is that the kit is a **lazy bundle**: components register
 * at import time, `desktop.min.js` never imports `os-spinner`, and
 * `customElements.define( 'os-spinner' )` only runs once
 * `os-components[.min].js` has been fetched. An `<os-spinner>` here
 * would therefore be an inert unknown element for the whole of the
 * window this file exists to cover — invisible exactly when it is
 * needed — and would trip the missing-import warner on the way past.
 * Calling `loadComponents()` first would mean waiting on another
 * bundle in order to say "please wait", which is the opposite of the
 * point. Twelve lines of inline CSS is the cheaper correct answer.
 */

import { __ } from '../i18n';

const PLACEHOLDER_ID = 'os-ai-loading';
const KEYFRAMES_ID = 'os-ai-loading-keyframes';

let active: HTMLElement | null = null;
let escapeHandler: ( ( e: KeyboardEvent ) => void ) | null = null;

/** Injects the spin keyframes once; skipped under reduced motion. */
function ensureKeyframes(): void {
	if ( document.getElementById( KEYFRAMES_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = KEYFRAMES_ID;
	style.textContent =
		'@keyframes os-ai-loading-spin{to{transform:rotate(360deg)}}';
	document.head.appendChild( style );
}

/**
 * Paint the placeholder, unless one is already up.
 *
 * Safe to call repeatedly — a second ⌘K while the first is still
 * loading reuses the element rather than stacking a second copy.
 *
 * **The Escape listener is document-level and belongs here**, because
 * during this window there is nothing else to hang it on. The real
 * panel binds Escape to its own root element (`impl.ts`), which does
 * not exist until the impl bundle has loaded and mounted, and the
 * palette cycle in `src/palette-registry.ts` deliberately never
 * listens for Escape — it says so itself. So without this, Escape is
 * dead for exactly as long as the placeholder is up, which is the one
 * moment the user is most likely to press it.
 *
 * @param onCancel Invoked when the user presses Escape before the
 *                 panel arrives. The caller uses it to drop its
 *                 pending-open intent, so the panel does not open
 *                 afterwards behind the user's back.
 */
export function showPalettePlaceholder( onCancel?: () => void ): void {
	if ( active && active.isConnected ) {
		return;
	}

	escapeHandler = ( e: KeyboardEvent ) => {
		if ( 'Escape' !== e.key ) {
			return;
		}
		hidePalettePlaceholder();
		onCancel?.();
	};
	document.addEventListener( 'keydown', escapeHandler );

	const reduceMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	const el = document.createElement( 'div' );
	el.id = PLACEHOLDER_ID;
	// `aria-live` rather than `role="dialog"`: this is a transient
	// status, not something the user can interact with, and announcing
	// it as a dialog would move focus away from wherever the real panel
	// is about to claim it.
	el.setAttribute( 'role', 'status' );
	el.setAttribute( 'aria-live', 'polite' );
	el.style.cssText = [
		'position:fixed',
		'inset:0',
		'z-index:10000',
		'display:flex',
		'align-items:flex-start',
		'justify-content:center',
		'padding-top:clamp(60px,16vh,180px)',
		'padding-inline:16px',
		'pointer-events:none',
	].join( ';' );

	const panel = document.createElement( 'div' );
	panel.style.cssText = [
		'display:flex',
		'align-items:center',
		'gap:12px',
		'width:100%',
		'max-width:600px',
		'box-sizing:border-box',
		'padding:20px 22px',
		'border-radius:16px',
		'font-size:14px',
		'font-family:inherit',
		// Same token-with-literal-fallback discipline the stylesheets
		// use: the palette resolves through these names, and the
		// literal is the pre-brand admin value.
		'background:var(--os-ai-panel-bg,var(--os-ui-surface,rgba(255,255,255,0.97)))',
		'color:var(--os-ui-fg,#1d2327)',
		'box-shadow:0 12px 40px rgba(0,0,0,0.22)',
	].join( ';' );

	const spinner = document.createElement( 'span' );
	spinner.setAttribute( 'aria-hidden', 'true' );
	spinner.style.cssText = [
		'flex:0 0 auto',
		'width:16px',
		'height:16px',
		'border-radius:50%',
		'border:2px solid currentColor',
		'border-top-color:transparent',
		'opacity:0.7',
	].join( ';' );
	if ( ! reduceMotion ) {
		ensureKeyframes();
		spinner.style.animation = 'os-ai-loading-spin 0.7s linear infinite';
	}

	const label = document.createElement( 'span' );
	label.textContent = __( 'Starting the command palette…' );

	panel.appendChild( spinner );
	panel.appendChild( label );
	el.appendChild( panel );
	document.body.appendChild( el );
	active = el;
}

/** Remove the placeholder, if one is up. */
export function hidePalettePlaceholder(): void {
	if ( escapeHandler ) {
		document.removeEventListener( 'keydown', escapeHandler );
		escapeHandler = null;
	}
	if ( active ) {
		active.remove();
		active = null;
	}
	// Belt and braces: a stray copy from an earlier bundle version, or
	// one left behind if `active` was cleared without a remove.
	document.getElementById( PLACEHOLDER_ID )?.remove();
}
