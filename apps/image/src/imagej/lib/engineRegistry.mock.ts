/**
 * 算子注册表的占位数据（UI 开发用）。
 *
 * 正式注册表由计算引擎发布；UI 只按 OperatorRegistry 的形状渲染，
 * 引擎接进来时把这里换成 adapter.registry() 即可，面板代码不变。
 */

import type { NumberParamSpec, OperatorRegistry, OperatorSpec } from './engineTypes'

function number(
  key: string,
  labelKey: string,
  fallback: number,
  min?: number,
  max?: number,
  step?: number,
): NumberParamSpec {
  return { key, type: 'number', labelKey, default: fallback, min, max, step }
}

function image(kind: string, category: string, labelKey: string, params: OperatorSpec['params'] = []): OperatorSpec {
  return { kind, category, labelKey, output: 'image', params }
}

export const MOCK_REGISTRY: OperatorRegistry = {
  categories: ['format', 'adjust', 'threshold', 'filter', 'morphology', 'geometry', 'analysis'],
  operators: [
    image('grayscale', 'format', 'grayscale'),

    image('invert', 'adjust', 'invert'),
    image('levels', 'adjust', 'levels', [
      number('brightness', 'brightness', 0, -127, 127),
      number('contrast', 'contrast', 50, 1, 100),
    ]),

    image('threshold', 'threshold', 'threshold', [number('level', 'level', 128, 0, 255)]),
    image('otsu', 'threshold', 'otsu'),

    image('mean3x3', 'filter', 'mean3x3'),
    image('median3x3', 'filter', 'median3x3'),
    image('sharpen3x3', 'filter', 'sharpen3x3'),
    image('sobel', 'filter', 'sobel'),
    image('minimum3x3', 'filter', 'minimum3x3'),
    image('maximum3x3', 'filter', 'maximum3x3'),
    image('gaussian', 'filter', 'gaussian', [number('sigma', 'sigma', 1.5, 0.1, 20, 0.1)]),

    image('erode', 'morphology', 'erode'),
    image('dilate', 'morphology', 'dilate'),
    image('open', 'morphology', 'open'),
    image('close', 'morphology', 'close'),
    image('fillHoles', 'morphology', 'fillHoles'),

    image('crop', 'geometry', 'crop', [
      number('x', 'x', 0, 0),
      number('y', 'y', 0, 0),
      number('width', 'width', 128, 1),
      number('height', 'height', 128, 1),
    ]),
    image('flipH', 'geometry', 'flipH'),
    image('flipV', 'geometry', 'flipV'),
    image('rotateCW', 'geometry', 'rotateCW'),
    image('rotateCCW', 'geometry', 'rotateCCW'),

    { kind: 'measure', category: 'analysis', labelKey: 'measure', output: 'stats', params: [] },
    {
      kind: 'particles',
      category: 'analysis',
      labelKey: 'particles',
      output: 'table',
      params: [number('minArea', 'minArea', 1, 1)],
    },
  ],
}

export function defaultParams(operator: OperatorSpec): Record<string, number | string> {
  const params: Record<string, number | string> = {}
  for (const spec of operator.params) {
    params[spec.key] = spec.default
  }
  return params
}
