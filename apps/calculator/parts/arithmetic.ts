export type CalculatorState = {
	display: string;
	accumulator: string;
	operator: string;
	operand: string;
	repeat: string;
	waiting: boolean;
	finished: boolean;
	error: boolean;
	expression: string;
};

export const initialState = (): CalculatorState => ( {
	display: '0', accumulator: '', operator: '', operand: '', repeat: '',
	waiting: false, finished: false, error: false, expression: '',
} );

export const symbol = ( operator: string ): string =>
	( { '+': '+', '-': '−', '*': '×', '/': '÷' } as Record< string, string > )[ operator ] ?? '';

const format = ( value: number ): string =>
	Number.isFinite( value ) ? String( Number( value.toPrecision( 12 ) ) ) : '';

const calculate = ( left: number, operator: string, right: number ): number => {
	switch ( operator ) {
		case '+': return left + right;
		case '-': return left - right;
		case '*': return left * right;
		case '/': return right === 0 ? NaN : left / right;
		default: return right;
	}
};

function result( state: CalculatorState, value: number ): void {
	const display = format( value );
	if ( display === '' ) {
		Object.assign( state, initialState(), { error: true } );
	} else {
		state.display = display;
	}
}

export function press( current: CalculatorState, key: string ): CalculatorState {
	const state = { ...current };
	if ( key === 'clear' ) {
		return initialState();
	}
	if ( ! /^(\d|\.|\+|-|\*|\/|=|sign|percent|backspace)$/.test( key ) ) {
		return state;
	}
	if ( state.error ) {
		if ( ! /^(\d|\.)$/.test( key ) ) {
			return state;
		}
		Object.assign( state, initialState() );
	}
	if ( /^(\d|\.)$/.test( key ) ) {
		if ( state.finished ) {
			Object.assign( state, initialState() );
		}
		if ( state.waiting || state.display.includes( 'e' ) ) {
			state.display = '0';
			state.waiting = false;
		}
		if ( key === '.' ) {
			if ( ! state.display.includes( '.' ) ) {
				state.display += '.';
			}
		} else if ( state.display.replace( /\D/g, '' ).length < 12 ) {
			if ( state.display === '0' || state.display === '-0' ) {
				state.display = state.display.startsWith( '-' ) ? `-${ key }` : key;
			} else {
				state.display += key;
			}
		}
		return state;
	}
	if ( key === 'backspace' ) {
		if ( ! state.waiting && ! state.finished && ! state.display.includes( 'e' ) ) {
			state.display = state.display.slice( 0, -1 );
			if ( state.display === '' || state.display === '-' ) {
				state.display = '0';
			}
		}
		return state;
	}
	if ( key === 'sign' || key === 'percent' ) {
		if ( state.waiting ) {
			state.display = '0';
			state.waiting = false;
		}
		if ( key === 'sign' ) {
			state.display = state.display.startsWith( '-' ) ? state.display.slice( 1 ) : `-${ state.display }`;
		} else {
			const base = state.operator === '+' || state.operator === '-' ? Number( state.accumulator ) : 1;
			result( state, base * Number( state.display ) / 100 );
		}
		state.repeat = '';
		if ( state.operator === '' ) {
			state.expression = '';
		}
		return state;
	}
	if ( key === '=' ) {
		const operator = state.operator || state.repeat;
		if ( operator === '' ) {
			return state;
		}
		const left = state.operator ? state.accumulator : state.display;
		const right = state.operator ? state.display : state.operand;
		result( state, calculate( Number( left ), operator, Number( right ) ) );
		if ( ! state.error ) {
			state.expression = `${ left } ${ symbol( operator ) } ${ right } =`;
			state.operand = right;
			state.repeat = operator;
			state.operator = '';
			state.accumulator = '';
			state.finished = true;
			state.waiting = false;
		}
		return state;
	}
	if ( state.operator && ! state.waiting ) {
		result( state, calculate( Number( state.accumulator ), state.operator, Number( state.display ) ) );
	}
	if ( ! state.error ) {
		state.accumulator = state.display;
		state.operator = key;
		state.expression = `${ state.display } ${ symbol( key ) }`;
		state.waiting = true;
		state.finished = false;
		state.repeat = '';
	}
	return state;
}

export function keyboardKey( event: KeyboardEvent ): string | null {
	if ( event.ctrlKey || event.metaKey || event.altKey || event.isComposing ) {
		return null;
	}
	if ( /^[\d.+\-*/=]$/.test( event.key ) ) {
		return event.key;
	}
	return ( { Enter: '=', Escape: 'clear', Delete: 'clear', Backspace: 'backspace', '%': 'percent', ',': '.' } as Record< string, string > )[ event.key ] ?? null;
}
