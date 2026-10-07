export interface MatchableWord {

	id: number;

	text: string;

	y: number;
}

export type MatchResult =
	| { kind: 'locked'; targetId: number; matchedCount: number }
	| { kind: 'advanced'; targetId: number; matchedCount: number }
	| { kind: 'completed'; targetId: number }
	| { kind: 'typo'; targetId: number }
	| { kind: 'ignored' };

export interface Matcher {

	handleKey: ( ch: string, live: readonly MatchableWord[] ) => MatchResult;

	handleBackspace: () => void;

	release: () => void;

	forget: ( wordId: number ) => void;

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
