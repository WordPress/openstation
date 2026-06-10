/**
 * Desktop Mode — Bug Report native window.
 *
 * A built-in native app that lets users file issues against the
 * plugin's GitHub repo without leaving the admin. The form gathers
 * a small structured payload (type, title, description, repro
 * steps, environment) and opens GitHub's `/issues/new` URL with
 * `?title=…&body=…&labels=…` pre-filled — the user reviews on
 * GitHub before submitting, so we never POST on their behalf and
 * never need an OAuth token.
 *
 * Three entry points all converge here:
 *   1. The admin-bar "Report a bug" button (PHP node, dispatches
 *      `desktop-mode-open-bug-report`).
 *   2. The dock system tile registered in `src/desktop.ts`.
 *   3. Future: a desktop widget. Same target, no special-casing.
 *
 * @since 0.6.2
 */

import { __ } from '../i18n';

/** Public window id — shared with `src/desktop.ts` for tile + opener wiring. */
export const BUG_REPORT_WINDOW_ID = 'desktop-mode-bug-report';

/** GitHub repo the issue is filed against. */
const REPO_OWNER = 'WordPress';
const REPO_NAME = 'desktop-mode';

/**
 * Conservative cap on the body length passed via `?body=…`. GitHub
 * accepts up to ~8KB of URL, but the rest of the URL (origin + path
 * + title param + labels) eats some of that — 6KB for `body` keeps
 * us under the limit with a comfortable margin.
 */
const MAX_BODY_LENGTH = 6000;

interface FormState {
	type: 'bug' | 'feature' | 'question';
	title: string;
	description: string;
	steps: string;
}

/**
 * Render the Bug Report form into a native window body.
 *
 * Called by the manager via `config.render(body)` when the window
 * opens. Returns nothing — mutates `body` in place.
 */
export function renderBugReport( body: HTMLElement ): void {
	body.classList.add( 'desktop-mode-bug-report' );
	body.replaceChildren();

	const form = document.createElement( 'form' );
	form.className = 'desktop-mode-bug-report__form';
	form.setAttribute( 'novalidate', '' );

	const intro = document.createElement( 'p' );
	intro.className = 'desktop-mode-bug-report__intro';
	intro.textContent = __(
		'Found a bug or have a feature idea? Fill this in and we will open a pre-filled GitHub issue for you to review and submit.',
	);
	form.appendChild( intro );

	form.appendChild( buildTypeField() );
	form.appendChild( buildTextField( 'title', __( 'Title' ), {
		placeholder: __( 'A short summary' ),
		required: true,
	} ) );
	form.appendChild( buildTextareaField( 'description', __( 'What happened? What did you expect?' ), {
		placeholder: __( 'Describe the issue or the feature you have in mind.' ),
		rows: 5,
		required: true,
	} ) );
	form.appendChild( buildTextareaField( 'steps', __( 'Steps to reproduce (bug only)' ), {
		placeholder: __( 'One step per line' ),
		rows: 4,
	} ) );

	const meta = buildMetadataPreview();
	form.appendChild( meta );

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-bug-report__actions';

	const submit = document.createElement( 'button' );
	submit.type = 'submit';
	submit.className = 'desktop-mode-bug-report__submit';
	submit.textContent = __( 'Open issue on GitHub' );
	actions.appendChild( submit );

	const hint = document.createElement( 'span' );
	hint.className = 'desktop-mode-bug-report__hint';
	hint.textContent = __( 'You will review and submit on GitHub.' );
	actions.appendChild( hint );

	form.appendChild( actions );

	form.addEventListener( 'submit', ( e: Event ) => {
		e.preventDefault();
		const state = readFormState( form );
		if ( ! state.title.trim() || ! state.description.trim() ) {
			// Lightweight inline validation — title + description are
			// both load-bearing; the rest is optional. Native HTML
			// validation would clobber our submit handler with a
			// browser-rendered tooltip, so keep it form-driven.
			showInlineError( form, __( 'Title and description are both required.' ) );
			return;
		}
		const url = buildGithubIssueUrl( state );
		window.open( url, '_blank', 'noopener' );
	} );

	body.appendChild( form );
}

/* ──────────────────────────────────────────────────────────────────
   Field builders.
   ────────────────────────────────────────────────────────────────── */

function buildTypeField(): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-bug-report__field desktop-mode-bug-report__field--type';

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-bug-report__label';
	label.textContent = __( 'Type' );
	wrap.appendChild( label );

	const group = document.createElement( 'div' );
	group.className = 'desktop-mode-bug-report__radio-group';
	group.setAttribute( 'role', 'radiogroup' );

	const options: { value: FormState[ 'type' ]; label: string; checked?: boolean }[] = [
		{ value: 'bug', label: __( 'Bug' ), checked: true },
		{ value: 'feature', label: __( 'Feature request' ) },
		{ value: 'question', label: __( 'Question' ) },
	];
	for ( const opt of options ) {
		const radioLabel = document.createElement( 'label' );
		radioLabel.className = 'desktop-mode-bug-report__radio';
		const input = document.createElement( 'input' );
		input.type = 'radio';
		input.name = 'type';
		input.value = opt.value;
		if ( opt.checked ) {
			input.checked = true;
		}
		radioLabel.appendChild( input );
		const text = document.createElement( 'span' );
		text.textContent = opt.label;
		radioLabel.appendChild( text );
		group.appendChild( radioLabel );
	}
	wrap.appendChild( group );
	return wrap;
}

function buildTextField(
	name: keyof FormState,
	labelText: string,
	opts: { placeholder?: string; required?: boolean } = {},
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-bug-report__field';

	const label = document.createElement( 'label' );
	label.className = 'desktop-mode-bug-report__label';
	label.textContent = labelText;
	wrap.appendChild( label );

	const input = document.createElement( 'input' );
	input.type = 'text';
	input.name = name;
	input.className = 'desktop-mode-bug-report__input';
	if ( opts.placeholder ) {
		input.placeholder = opts.placeholder;
	}
	if ( opts.required ) {
		input.setAttribute( 'aria-required', 'true' );
	}
	label.appendChild( input );

	return wrap;
}

function buildTextareaField(
	name: keyof FormState,
	labelText: string,
	opts: { placeholder?: string; rows?: number; required?: boolean } = {},
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-bug-report__field';

	const label = document.createElement( 'label' );
	label.className = 'desktop-mode-bug-report__label';
	label.textContent = labelText;
	wrap.appendChild( label );

	const textarea = document.createElement( 'textarea' );
	textarea.name = name;
	textarea.className = 'desktop-mode-bug-report__textarea';
	textarea.rows = opts.rows ?? 4;
	if ( opts.placeholder ) {
		textarea.placeholder = opts.placeholder;
	}
	if ( opts.required ) {
		textarea.setAttribute( 'aria-required', 'true' );
	}
	label.appendChild( textarea );

	return wrap;
}

/**
 * Read-only summary of what we'll append to the issue body. Showing
 * it inline keeps the user honest about what gets sent — no surprise
 * data leak when the GitHub URL opens.
 */
function buildMetadataPreview(): HTMLElement {
	const details = document.createElement( 'details' );
	details.className = 'desktop-mode-bug-report__metadata';

	const summary = document.createElement( 'summary' );
	summary.textContent = __( 'Environment included with the report' );
	details.appendChild( summary );

	const pre = document.createElement( 'pre' );
	pre.className = 'desktop-mode-bug-report__metadata-body';
	pre.textContent = formatMetadata( collectMetadata() );
	details.appendChild( pre );

	return details;
}

function showInlineError( form: HTMLFormElement, msg: string ): void {
	let banner = form.querySelector< HTMLElement >( '.desktop-mode-bug-report__error' );
	if ( ! banner ) {
		banner = document.createElement( 'div' );
		banner.className = 'desktop-mode-bug-report__error';
		banner.setAttribute( 'role', 'alert' );
		form.prepend( banner );
	}
	banner.textContent = msg;
}

/* ──────────────────────────────────────────────────────────────────
   State + URL building.
   ────────────────────────────────────────────────────────────────── */

function readFormState( form: HTMLFormElement ): FormState {
	const data = new FormData( form );
	return {
		type: ( data.get( 'type' ) as FormState[ 'type' ] ) ?? 'bug',
		title: ( data.get( 'title' ) as string ) ?? '',
		description: ( data.get( 'description' ) as string ) ?? '',
		steps: ( data.get( 'steps' ) as string ) ?? '',
	};
}

/**
 * Compose the GitHub issue URL with `?title=…&body=…&labels=…`.
 * Exported so tests can pin the contract independently of the form
 * scaffolding.
 */
export function buildGithubIssueUrl( state: FormState ): string {
	const labels = labelsForType( state.type );
	const body = composeIssueBody( state );
	const params = new URLSearchParams();
	params.set( 'title', state.title.trim() );
	params.set( 'body', body );
	if ( labels.length ) {
		params.set( 'labels', labels.join( ',' ) );
	}
	return `https://github.com/${ REPO_OWNER }/${ REPO_NAME }/issues/new?${ params.toString() }`;
}

function labelsForType( type: FormState[ 'type' ] ): string[] {
	switch ( type ) {
		case 'bug':
			return [ 'bug' ];
		case 'feature':
			return [ 'enhancement' ];
		case 'question':
			return [ 'question' ];
		default:
			return [];
	}
}

function composeIssueBody( state: FormState ): string {
	const parts: string[] = [];
	parts.push( state.description.trim() );
	if ( state.type === 'bug' && state.steps.trim() ) {
		parts.push( '' );
		parts.push( '## Steps to reproduce' );
		parts.push( '' );
		parts.push( state.steps.trim() );
	}
	parts.push( '' );
	parts.push( '<details><summary>Environment</summary>' );
	parts.push( '' );
	parts.push( '```' );
	parts.push( formatMetadata( collectMetadata() ) );
	parts.push( '```' );
	parts.push( '' );
	parts.push( '</details>' );
	let out = parts.join( '\n' );
	if ( out.length > MAX_BODY_LENGTH ) {
		out =
			out.slice( 0, MAX_BODY_LENGTH ) +
			'\n\n…(truncated to fit GitHub URL length limit)';
	}
	return out;
}

/* ──────────────────────────────────────────────────────────────────
   Metadata collection.
   ────────────────────────────────────────────────────────────────── */

interface Metadata {
	pluginVersion: string;
	wordpressVersion: string;
	userAgent: string;
	viewport: string;
	platform: string;
	currentUrl: string;
}

function collectMetadata(): Metadata {
	const cfg = ( window as unknown as {
		wp?: { desktop?: { config?: { pluginVersion?: string; wordpressVersion?: string } } };
	} ).wp?.desktop?.config;
	return {
		pluginVersion: cfg?.pluginVersion ?? 'unknown',
		wordpressVersion: cfg?.wordpressVersion ?? 'unknown',
		userAgent: navigator.userAgent,
		viewport: `${ window.innerWidth }x${ window.innerHeight }`,
		platform: navigator.platform || 'unknown',
		currentUrl: window.location.href,
	};
}

function formatMetadata( m: Metadata ): string {
	return [
		`Plugin version:    ${ m.pluginVersion }`,
		`WordPress version: ${ m.wordpressVersion }`,
		`User agent:        ${ m.userAgent }`,
		`Viewport:          ${ m.viewport }`,
		`Platform:          ${ m.platform }`,
		`Current URL:       ${ m.currentUrl }`,
	].join( '\n' );
}
