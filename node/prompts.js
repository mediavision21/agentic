import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as yamlLoad } from 'js-yaml'

const SKILLS = join(import.meta.dirname, '..', 'skills')

let _generate, _plot, _intentExtract

export function getGeneratePrompt() {
	if (!_generate) {
		_generate = yamlLoad(readFileSync(join(SKILLS, 'generate-v1.yaml'), 'utf8'))
	}
	return _generate
}

export function getPlotPrompt() {
	if (!_plot) {
		_plot = yamlLoad(readFileSync(join(SKILLS, 'plot-v3.yaml'), 'utf8'))
	}
	return _plot
}

export function getIntentExtractPrompt() {
	if (!_intentExtract) {
		_intentExtract = yamlLoad(readFileSync(join(SKILLS, 'intent-extract.yaml'), 'utf8'))
	}
	return _intentExtract
}
