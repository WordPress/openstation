<?php

namespace OpenStation\Sniffs\Files;

use PHP_CodeSniffer\Files\File;
use PHP_CodeSniffer\Sniffs\Sniff;

class FileLengthSniff implements Sniff {

	public $maxLines = 1000;

	public $idealMin = 300;

	public $idealMax = 600;

	public function register() {
		return array( T_OPEN_TAG );
	}

	public function process( File $phpcsFile, $stackPtr ) {
		$tokens = $phpcsFile->getTokens();
		$lines  = $tokens[ $phpcsFile->numTokens - 1 ]['line'];

		if ( $lines > (int) $this->maxLines ) {
			$phpcsFile->addWarning(
				'This file is %d lines — past the %d-line comfort zone. Be smart, build robust software: modules of ~%d–%d lines are easier to read, test, review and reuse. Consider splitting this one along its natural seams — future you will say thanks.',
				$stackPtr,
				'TooLong',
				array(
					$lines,
					(int) $this->maxLines,
					(int) $this->idealMin,
					(int) $this->idealMax,
				)
			);
		}

		return $phpcsFile->numTokens;
	}
}
