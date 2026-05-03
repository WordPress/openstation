/**
 * Routines — AI "Describe it" composer.
 *
 * Inline strip above the canvas: text input + Generate button.
 * Sends the user's plain-language prompt to
 * `POST /wp-desktop/v1/routines/from-prompt`, which returns a
 * fully-validated routine def. On success, the composer replaces
 * the current routine.def in place, the canvas rerenders, and
 * the user reviews + saves.
 *
 * Keyboard shortcut: Cmd/Ctrl+K focuses the input from anywhere
 * in the routines window. Cmd/Ctrl+Enter submits.
 *
 * @since 0.22.0
 */

import { el } from './dom';
import { generateFromPrompt, RestError } from './rest';
import type { RoutineDef } from './types';

export interface ComposerHandle {
	root: HTMLElement;
	focus: () => void;
}

export interface ComposerContext {
	/** Called with the AI-generated def. Caller replaces routine.def + rerenders. */
	onGenerated: ( def: RoutineDef, meta: { model: string; latencyMs: number } ) => void;
}

/**
 * Build the composer element. Caller mounts it above the canvas
 * and triggers `handle.focus()` on Cmd/Ctrl+K.
 *
 * @since 0.22.0
 */
export function buildComposer( ctx: ComposerContext ): ComposerHandle {
	const root = el( 'section', { class: 'wpdm-routines__composer' } );

	const sparkle = el( 'span', { class: 'wpdm-routines__composer-icon' } );
	sparkle.textContent = '✨';

	const input = el( 'textarea', {
		class: 'wpdm-routines__composer-input',
		spellcheck: true,
		placeholder:
			"Describe the routine you want — e.g. \"When a comment with 'casino' arrives, trash it and email me.\"  (Cmd/Ctrl+Enter to generate)",
		rows: 2,
	} ) as HTMLTextAreaElement;

	const generateBtn = el( 'button', {
		class: 'wpdm-routines__composer-btn',
		type: 'button',
	} ) as HTMLButtonElement;
	generateBtn.textContent = 'Generate';

	const status = el( 'span', { class: 'wpdm-routines__composer-status' } );

	root.append( sparkle, input, generateBtn, status );

	let busy = false;

	const submit = async (): Promise< void > => {
		if ( busy ) {
			return;
		}
		const prompt = input.value.trim();
		if ( ! prompt ) {
			input.focus();
			return;
		}
		busy = true;
		generateBtn.disabled = true;
		generateBtn.textContent = 'Generating…';
		status.className = 'wpdm-routines__composer-status';
		status.textContent = '';
		root.classList.add( 'is-busy' );

		try {
			const result = await generateFromPrompt( prompt );
			ctx.onGenerated( result.def, {
				model: result.used_model,
				latencyMs: result.latency_ms,
			} );
			status.className =
				'wpdm-routines__composer-status is-success';
			status.textContent = `Generated in ${ result.latency_ms }ms — review and Save when ready.`;
			input.value = ''; // free the box for the next idea
		} catch ( err ) {
			status.className = 'wpdm-routines__composer-status is-error';
			status.textContent = describeError( err );
		} finally {
			busy = false;
			generateBtn.disabled = false;
			generateBtn.textContent = 'Generate';
			root.classList.remove( 'is-busy' );
		}
	};

	generateBtn.addEventListener( 'click', () => void submit() );
	input.addEventListener( 'keydown', ( ev ) => {
		const e = ev as KeyboardEvent;
		if ( ( e.metaKey || e.ctrlKey ) && e.key === 'Enter' ) {
			e.preventDefault();
			void submit();
		}
	} );

	return {
		root,
		focus: () => input.focus(),
	};
}

function describeError( err: unknown ): string {
	if ( err instanceof RestError ) {
		// Surface the model's validation gap when present — the
		// server reflects the raw def back inside `data.raw_def`
		// for `wpdm_routine_*` validation errors.
		return `${ err.code } — ${ err.message }`;
	}
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}
