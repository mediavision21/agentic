import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as yamlLoad } from 'js-yaml'

const BACKEND = join(import.meta.dirname, '..', 'backend')

let _generate, _plot, _intentExtract

export function getGeneratePrompt() {
    if (!_generate) {
        _generate = yamlLoad(readFileSync(join(BACKEND, 'generate-v1.yaml'), 'utf8'))
    }
    return _generate
}

export function getPlotPrompt() {
    if (!_plot) {
        _plot = yamlLoad(readFileSync(join(BACKEND, 'plot-v3.yaml'), 'utf8'))
    }
    return _plot
}

export function getIntentExtractPrompt() {
    if (!_intentExtract) {
        _intentExtract = yamlLoad(readFileSync(join(BACKEND, 'intent-extract.yaml'), 'utf8'))
    }
    return _intentExtract
}
