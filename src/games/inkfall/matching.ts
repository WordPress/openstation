/**
 * Inkfall — target lock / prefix matching state machine.
 *
 * Pure: no DOM, no Pixi. The game feeds keystrokes and the current
 * live-word list; the matcher decides which word is locked and how
 * far it has been typed.
 *
 * Targeting rules:
 *   - Idle (no lock): the first keystroke locks onto the LOWEST
 *     (closest-to-bottom) live word starting with that letter.
 *   - Locked: keys must match the next character of the locked
 *     word. A wrong key is a `typo` (streak resets; the lock is
 *     kept — no accidental retargeting mid-word).
 *   - Backspace steps the matched prefix back one character
 *     (keeping the lock); Escape releases the lock entirely.
 *   - Completing the last character reports `completed`.
 *
 * @since 0.9.6
 */

export interface MatchableWord {
	/** Stable id assigned by the spawner. */
	id: number;
	/** The lowercase word text. */
	text: string;
	/** Vertical progress — larger = closer to the bottom. */
	y: number;
}

export type MatchResult =
	| { kind: 'locked'; targetId: number; matchedCount: number }
	| { kind: 'advanced'; targetId: number; matchedCount: number }
	| { kind: 'completed'; targetId: number }
	| { kind: 'typo'; targetId: number }
	| { kind: 'ignored' };

export interface Matcher {
	/** Feed one lowercase letter with the current live words. */
	handleKey: ( ch: string, live: readonly MatchableWord[] ) => MatchResult;
	/** Step the matched prefix back one character (lock kept). */
	handleBackspace: () => void;
	/** Drop the lock; the word keeps falling untouched. */
	release: () => void;
	/** Forget the lock if it points at a word that left the field. */
	forget: ( wordId: number ) => void;
	/** Current lock state (for highlight rendering). */
	state: () => { targetId: number | null; matchedCount: number };
}

export function createMatcher(): Matcher {
	let targetId: number | null = null;
	let matchedCount = 0;

	const reset = (): void => {
		targetId = null;
		matchedCount = 0;
	};

	return {
		handleKey( ch, live ) {
			const letter = ch.toLowerCase();
			if ( letter.length !== 1 || ! /[a-z]/.test( letter ) ) {
				return { kind: 'ignored' };
			}

			if ( targetId === null ) {
				// Lock onto the lowest live word starting with the
				// letter — the most urgent candidate.
				let candidate: MatchableWord | null = null;
				for ( const word of live ) {
					if ( word.text[ 0 ] !== letter ) {
						continue;
					}
					if ( ! candidate || word.y > candidate.y ) {
						candidate = word;
					}
				}
				if ( ! candidate ) {
					return { kind: 'ignored' };
				}
				targetId = candidate.id;
				matchedCount = 1;
				if ( candidate.text.length === 1 ) {
					const completedId = targetId;
					reset();
					return { kind: 'completed', targetId: completedId };
				}
				return { kind: 'locked', targetId, matchedCount };
			}

			const target = live.find( ( word ) => word.id === targetId );
			if ( ! target ) {
				// The locked word left the field (reached the bottom or
				// was torn apart) — treat this keystroke as a fresh one.
				reset();
				return this.handleKey( letter, live );
			}

			if ( target.text[ matchedCount ] !== letter ) {
				return { kind: 'typo', targetId: target.id };
			}

			matchedCount++;
			if ( matchedCount >= target.text.length ) {
				const completedId = target.id;
				reset();
				return { kind: 'completed', targetId: completedId };
			}
			return { kind: 'advanced', targetId: target.id, matchedCount };
		},

		handleBackspace() {
			if ( targetId === null ) {
				return;
			}
			matchedCount = Math.max( 1, matchedCount - 1 );
		},

		release: reset,

		forget( wordId ) {
			if ( targetId === wordId ) {
				reset();
			}
		},

		state() {
			return { targetId, matchedCount };
		},
	};
}
