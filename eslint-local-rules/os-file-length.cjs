'use strict';

module.exports = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Warn when a file grows past the line-count comfort zone and suggest splitting it.',
		},
		schema: [
			{
				type: 'object',
				properties: {
					max: { type: 'integer', minimum: 1 },
					idealMin: { type: 'integer', minimum: 1 },
					idealMax: { type: 'integer', minimum: 1 },
				},
				additionalProperties: false,
			},
		],
		messages: {
			considerSplitting:
				'This file is {{lines}} lines — past the {{max}}-line comfort zone. Be smart, build robust software: modules of ~{{idealMin}}–{{idealMax}} lines are easier to read, test, review and reuse. Consider splitting this one along its natural seams — future you will say thanks.',
		},
	},

	create( context ) {
		const options = context.options[ 0 ] || {};
		const max = options.max || 1000;
		const idealMin = options.idealMin || 300;
		const idealMax = options.idealMax || 600;

		return {
			'Program:exit'( node ) {
				const lines = context.getSourceCode().lines.length;
				if ( lines <= max ) {
					return;
				}
				context.report( {

					loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
					node,
					messageId: 'considerSplitting',
					data: {
						lines: String( lines ),
						max: String( max ),
						idealMin: String( idealMin ),
						idealMax: String( idealMax ),
					},
				} );
			},
		};
	},
};
