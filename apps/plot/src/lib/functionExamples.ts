export interface FunctionExample {
  id: string
  expression: string
}

export const FUNCTION_EXAMPLES: FunctionExample[] = [
  { id: 'damped', expression: 'exp(-x/6) * sin(2x)' },
  { id: 'beats', expression: 'sin(x) + sin(1.7x)' },
  { id: 'gaussian', expression: 'exp(-(x - 2)^2 / 2)' },
  { id: 'sigmoid', expression: '1 / (1 + exp(-x))' },
  { id: 'sinc', expression: 'sin(x) / x' },
  { id: 'cubic', expression: 'x^3 - 3x' },
  { id: 'tangent', expression: 'tan(x)' },
  { id: 'amplitude', expression: 'a * sin(b*x) * exp(-x/5)' },
]
