/**
 * Joplot Expression Language (JEL) — 用户表达式引擎。
 *
 * 语法：MATLAB / Octave 标量表达式子集 + 少量文档化扩展。
 *   - 幂 `^`（右结合），扩展 `**` 别名
 *   - `log` = 自然对数（MATLAB/Python 惯例），另有 `log2`、`log10`、`log(x, base)`
 *   - 常量 pi/π、e、tau/τ、phi/φ、Inf/inf、NaN/nan、eps
 *   - 比较 `== ~= != < <= > >=`、逻辑 `& | ~` 与短路 `&& ||`、三元 `cond ? a : b`
 *   - 扩展：隐式乘法（`2x`、`x(x+1)`）、`ln` 别名、希腊/中文标识符
 *   - 标量运算符 `%` 保留为取模（与 MATLAB 注释含义不同，属文档化差异）
 *
 * 引擎：AST → 位置参数闭包 `(p, x, y) => number`，批量求值零每点分配。
 * 接口刻意保持可替换：将来可换成 JIT / WASM 后端而不改语法。
 */

export type ExpressionErrorCode =
  | 'empty'
  | 'unexpected-character'
  | 'invalid-number'
  | 'unexpected-end'
  | 'unexpected-token'
  | 'unbalanced-parenthesis'
  | 'function-needs-parentheses'
  | 'wrong-argument-count'

export interface ExpressionErrorParams {
  [key: string]: string | number | undefined
  token?: string
  name?: string
  expected?: string
  actual?: string
  position?: number
}

export class ExpressionError extends Error {
  readonly code: ExpressionErrorCode
  readonly position: number
  readonly params: ExpressionErrorParams

  constructor(code: ExpressionErrorCode, position: number, params: ExpressionErrorParams = {}) {
    super(`${code} at ${position}`)
    this.name = 'ExpressionError'
    this.code = code
    this.position = position
    this.params = { ...params, position }
  }
}

type BinaryOperator =
  | '+' | '-' | '*' | '/' | '%' | '^'
  | '==' | '~=' | '<' | '<=' | '>' | '>='
  | '&' | '|' | '&&' | '||'

type OperatorToken = BinaryOperator | '~' | '?' | ':' | '(' | ')' | ','

type Token =
  | { type: 'number'; value: number; start: number; end: number }
  | { type: 'identifier'; name: string; start: number; end: number }
  | { type: 'operator'; op: OperatorToken; start: number; end: number }
  | { type: 'end'; start: number; end: number }

type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: '+' | '-' | '~'; operand: AstNode }
  | { kind: 'binary'; op: BinaryOperator; left: AstNode; right: AstNode }
  | { kind: 'ternary'; condition: AstNode; consequent: AstNode; alternate: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }

export interface BuiltinFunction {
  fn: (...args: number[]) => number
  minArgs: number
  maxArgs: number
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - poly * Math.exp(-x * x))
}

const LANCZOS_G = 7
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
]

function gammaFn(z: number): number {
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z))
  }
  const x = z - 1
  let sum = LANCZOS_C[0]
  for (let i = 1; i < LANCZOS_G + 2; i += 1) {
    sum += LANCZOS_C[i] / (x + i)
  }
  const t = x + LANCZOS_G + 0.5
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * sum
}

function factorialFn(n: number): number {
  if (Number.isInteger(n)) {
    if (n < 0) return Number.NaN
    let result = 1
    for (let i = 2; i <= n; i += 1) result *= i
    return result
  }
  return gammaFn(n + 1)
}

function positiveMod(left: number, right: number): number {
  return ((left % right) + right) % right
}

function remainder(left: number, right: number): number {
  return left - right * Math.trunc(left / right)
}

function sinc(value: number): number {
  if (value === 0) return 1
  const t = Math.PI * value
  return Math.sin(t) / t
}

const BUILTIN_FUNCTIONS: Record<string, BuiltinFunction> = {
  sin: { fn: Math.sin, minArgs: 1, maxArgs: 1 },
  cos: { fn: Math.cos, minArgs: 1, maxArgs: 1 },
  tan: { fn: Math.tan, minArgs: 1, maxArgs: 1 },
  asin: { fn: Math.asin, minArgs: 1, maxArgs: 1 },
  acos: { fn: Math.acos, minArgs: 1, maxArgs: 1 },
  atan: { fn: Math.atan, minArgs: 1, maxArgs: 1 },
  atan2: { fn: Math.atan2, minArgs: 2, maxArgs: 2 },
  hypot: { fn: Math.hypot, minArgs: 2, maxArgs: 2 },
  sinh: { fn: Math.sinh, minArgs: 1, maxArgs: 1 },
  cosh: { fn: Math.cosh, minArgs: 1, maxArgs: 1 },
  tanh: { fn: Math.tanh, minArgs: 1, maxArgs: 1 },
  ln: { fn: Math.log, minArgs: 1, maxArgs: 1 },
  log: {
    fn: (value: number, base?: number) =>
      base === undefined ? Math.log(value) : Math.log(value) / Math.log(base),
    minArgs: 1,
    maxArgs: 2,
  },
  log2: { fn: Math.log2, minArgs: 1, maxArgs: 1 },
  log10: { fn: Math.log10, minArgs: 1, maxArgs: 1 },
  exp: { fn: Math.exp, minArgs: 1, maxArgs: 1 },
  sqrt: { fn: Math.sqrt, minArgs: 1, maxArgs: 1 },
  cbrt: { fn: Math.cbrt, minArgs: 1, maxArgs: 1 },
  abs: { fn: Math.abs, minArgs: 1, maxArgs: 1 },
  floor: { fn: Math.floor, minArgs: 1, maxArgs: 1 },
  ceil: { fn: Math.ceil, minArgs: 1, maxArgs: 1 },
  round: { fn: Math.round, minArgs: 1, maxArgs: 1 },
  fix: { fn: Math.trunc, minArgs: 1, maxArgs: 1 },
  sign: { fn: Math.sign, minArgs: 1, maxArgs: 1 },
  mod: { fn: positiveMod, minArgs: 2, maxArgs: 2 },
  rem: { fn: remainder, minArgs: 2, maxArgs: 2 },
  pow: { fn: Math.pow, minArgs: 2, maxArgs: 2 },
  min: { fn: (...args: number[]) => Math.min(...args), minArgs: 2, maxArgs: 8 },
  max: { fn: (...args: number[]) => Math.max(...args), minArgs: 2, maxArgs: 8 },
  factorial: { fn: factorialFn, minArgs: 1, maxArgs: 1 },
  gamma: { fn: gammaFn, minArgs: 1, maxArgs: 1 },
  gammaln: { fn: (value: number) => Math.log(Math.abs(gammaFn(value))), minArgs: 1, maxArgs: 1 },
  erf: { fn: erf, minArgs: 1, maxArgs: 1 },
  erfc: { fn: (value: number) => 1 - erf(value), minArgs: 1, maxArgs: 1 },
  sinc: { fn: sinc, minArgs: 1, maxArgs: 1 },
  clamp: { fn: (value: number, low: number, high: number) => Math.min(high, Math.max(low, value)), minArgs: 3, maxArgs: 3 },
  heaviside: { fn: (value: number) => (value < 0 ? 0 : value > 0 ? 1 : 0.5), minArgs: 1, maxArgs: 1 },
  deg2rad: { fn: (value: number) => (value * Math.PI) / 180, minArgs: 1, maxArgs: 1 },
  rad2deg: { fn: (value: number) => (value * 180) / Math.PI, minArgs: 1, maxArgs: 1 },
}

export const FUNCTION_NAMES = Object.keys(BUILTIN_FUNCTIONS)

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  'τ': Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
  'φ': (1 + Math.sqrt(5)) / 2,
  Inf: Number.POSITIVE_INFINITY,
  inf: Number.POSITIVE_INFINITY,
  Infinity: Number.POSITIVE_INFINITY,
  NaN: Number.NaN,
  nan: Number.NaN,
  eps: Number.EPSILON,
}

function isDigit(char: string) {
  return char >= '0' && char <= '9'
}

function isIdentifierStart(char: string) {
  return /[a-zA-Z_\u0370-\u03ff\u4e00-\u9fa5]/.test(char)
}

function isIdentifierChar(char: string) {
  return /[a-zA-Z0-9_\u0370-\u03ff\u4e00-\u9fa5]/.test(char)
}

function scanNumber(source: string, start: number): { value: number; end: number } | null {
  let index = start
  let sawDigit = false

  while (index < source.length && isDigit(source[index])) {
    index += 1
    sawDigit = true
  }

  if (source[index] === '.') {
    index += 1
    while (index < source.length && isDigit(source[index])) {
      index += 1
      sawDigit = true
    }
  }

  if (!sawDigit) {
    return null
  }

  // `e`/`E` 只有在其后跟数字（可带符号）时才属于这个数。
  if (source[index] === 'e' || source[index] === 'E') {
    let exponentEnd = index + 1
    if (source[exponentEnd] === '+' || source[exponentEnd] === '-') {
      exponentEnd += 1
    }
    if (isDigit(source[exponentEnd] ?? '')) {
      while (exponentEnd < source.length && isDigit(source[exponentEnd])) {
        exponentEnd += 1
      }
      index = exponentEnd
    }
  }

  return { value: Number(source.slice(start, index)), end: index }
}

function scanIdentifier(source: string, start: number): { name: string; end: number } {
  let index = start + 1
  while (index < source.length && isIdentifierChar(source[index])) {
    index += 1
  }
  return { name: source.slice(start, index), end: index }
}

const MULTI_CHAR_OPERATORS = ['==', '~=', '!=', '<=', '>=', '&&', '||', '**']
const SINGLE_OPERATORS: Record<string, OperatorToken> = {
  '+': '+', '-': '-', '*': '*', '/': '/', '%': '%', '^': '^',
  '<': '<', '>': '>', '&': '&', '|': '|', '~': '~',
  '?': '?', ':': ':', '(': '(', ')': ')', ',': ',',
}
const MULTIPLY_ALIASES = new Set(['*', '·', '×'])
const DIVIDE_ALIASES = new Set(['/', '÷'])
const MINUS_ALIASES = new Set(['-', '−', '—'])
const COMMA_ALIASES = new Set([',', '，', '、'])

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  const push = (op: OperatorToken, at: number) => {
    tokens.push({ type: 'operator', op, start: at, end: at + 1 })
  }

  while (index < source.length) {
    const char = source[index]

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    const twoChar = source.slice(index, index + 2)
    if (MULTI_CHAR_OPERATORS.includes(twoChar)) {
      const op = twoChar === '!=' ? '~=' : twoChar === '**' ? '^' : (twoChar as OperatorToken)
      tokens.push({ type: 'operator', op, start: index, end: index + 2 })
      index += 2
      continue
    }

    if (MULTIPLY_ALIASES.has(char)) {
      push('*', index)
      index += 1
      continue
    }
    if (DIVIDE_ALIASES.has(char)) {
      push('/', index)
      index += 1
      continue
    }
    if (MINUS_ALIASES.has(char)) {
      push('-', index)
      index += 1
      continue
    }
    if (COMMA_ALIASES.has(char)) {
      push(',', index)
      index += 1
      continue
    }
    if (char === '(' || char === '（') {
      push('(', index)
      index += 1
      continue
    }
    if (char === ')' || char === '）') {
      push(')', index)
      index += 1
      continue
    }
    if (char === '²' || char === '³') {
      push('^', index)
      tokens.push({ type: 'number', value: char === '²' ? 2 : 3, start: index, end: index + 1 })
      index += 1
      continue
    }

    if (isDigit(char) || char === '.') {
      const scanned = scanNumber(source, index)
      if (!scanned || !Number.isFinite(scanned.value)) {
        throw new ExpressionError('invalid-number', index, { token: source.slice(index, index + 4) })
      }
      if (source[scanned.end] === '.') {
        throw new ExpressionError('invalid-number', scanned.end, { token: source.slice(scanned.end, scanned.end + 4) })
      }
      tokens.push({ type: 'number', value: scanned.value, start: index, end: scanned.end })
      index = scanned.end
      continue
    }

    if (isIdentifierStart(char)) {
      const scanned = scanIdentifier(source, index)
      tokens.push({ type: 'identifier', name: scanned.name, start: index, end: scanned.end })
      index = scanned.end
      continue
    }

    if (char in SINGLE_OPERATORS) {
      push(SINGLE_OPERATORS[char], index)
      index += 1
      continue
    }

    throw new ExpressionError('unexpected-character', index, { token: char })
  }

  tokens.push({ type: 'end', start: source.length, end: source.length })
  return tokens
}

const BINARY_BINDING: Record<BinaryOperator, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '&': 4,
  '==': 5,
  '~=': 5,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  '^': 9,
}

const MULTIPLICATIVE_BINDING = 7
const UNARY_BINDING = 8
const TERNARY_BINDING = 0

function isBinaryOperator(op: OperatorToken): op is BinaryOperator {
  return op in BINARY_BINDING
}

const COMPARISON_OPERATORS = new Set<BinaryOperator>(['==', '~=', '<', '<=', '>', '>='])

function describeToken(token: Token): string {
  if (token.type === 'number') return String(token.value)
  if (token.type === 'identifier') return token.name
  if (token.type === 'operator') return token.op
  return ''
}

class Parser {
  private readonly tokens: Token[]
  private cursor = 0

  constructor(source: string) {
    this.tokens = tokenize(source)
  }

  private peek(): Token {
    return this.tokens[this.cursor]
  }

  private advance(): Token {
    const token = this.tokens[this.cursor]
    this.cursor += 1
    return token
  }

  private isOperator(token: Token, op: OperatorToken) {
    return token.type === 'operator' && token.op === op
  }

  parse(): AstNode {
    if (this.peek().type === 'end') {
      throw new ExpressionError('empty', 0)
    }

    const node = this.parseExpression(0)
    const trailing = this.peek()

    if (trailing.type !== 'end') {
      if (this.isOperator(trailing, ')')) {
        throw new ExpressionError('unbalanced-parenthesis', trailing.start, { token: ')' })
      }
      throw new ExpressionError('unexpected-token', trailing.start, { token: describeToken(trailing) })
    }

    return node
  }

  private parseExpression(minBindingPower: number): AstNode {
    let left = this.parsePrefix()

    for (;;) {
      const token = this.peek()

      if (token.type === 'operator' && isBinaryOperator(token.op)) {
        const bindingPower = BINARY_BINDING[token.op]
        if (bindingPower < minBindingPower) {
          break
        }
        this.advance()
        const rightAssociative = token.op === '^'
        const right = this.parseExpression(rightAssociative ? bindingPower : bindingPower + 1)
        left = { kind: 'binary', op: token.op, left, right }
        continue
      }

      if (this.isOperator(token, '?') && minBindingPower <= TERNARY_BINDING) {
        this.advance()
        const consequent = this.parseExpression(0)
        if (!this.isOperator(this.peek(), ':')) {
          throw new ExpressionError('unexpected-token', this.peek().start, { token: describeToken(this.peek()) })
        }
        this.advance()
        const alternate = this.parseExpression(TERNARY_BINDING)
        left = { kind: 'ternary', condition: left, consequent, alternate }
        continue
      }

      if (this.startsPrimary(token)) {
        if (MULTIPLICATIVE_BINDING < minBindingPower) {
          break
        }
        const right = this.parseExpression(MULTIPLICATIVE_BINDING + 1)
        left = { kind: 'binary', op: '*', left, right }
        continue
      }

      break
    }

    return left
  }

  private startsPrimary(token: Token) {
    return token.type === 'number'
      || token.type === 'identifier'
      || (token.type === 'operator' && token.op === '(')
  }

  private parsePrefix(): AstNode {
    const token = this.peek()

    if (this.isOperator(token, '-') || this.isOperator(token, '+') || this.isOperator(token, '~')) {
      const op = (token as { op: '+' | '-' | '~' }).op
      this.advance()
      return { kind: 'unary', op, operand: this.parseExpression(UNARY_BINDING) }
    }

    if (token.type === 'number') {
      this.advance()
      return { kind: 'number', value: token.value }
    }

    if (token.type === 'identifier') {
      return this.parseIdentifier()
    }

    if (this.isOperator(token, '(')) {
      this.advance()
      const inner = this.parseExpression(0)
      if (!this.isOperator(this.peek(), ')')) {
        throw new ExpressionError('unexpected-end', this.peek().start)
      }
      this.advance()
      return inner
    }

    if (token.type === 'end') {
      throw new ExpressionError('unexpected-end', token.start)
    }

    throw new ExpressionError('unexpected-token', token.start, { token: describeToken(token) })
  }

  private parseIdentifier(): AstNode {
    const token = this.advance()
    if (token.type !== 'identifier') {
      throw new ExpressionError('unexpected-token', token.start)
    }

    const name = token.name
    const builtin = BUILTIN_FUNCTIONS[name]

    if (builtin) {
      if (!this.isOperator(this.peek(), '(')) {
        throw new ExpressionError('function-needs-parentheses', token.start, { name })
      }
      this.advance()
      const args: AstNode[] = []
      if (!this.isOperator(this.peek(), ')')) {
        args.push(this.parseExpression(0))
        while (this.isOperator(this.peek(), ',')) {
          this.advance()
          args.push(this.parseExpression(0))
        }
      }
      if (!this.isOperator(this.peek(), ')')) {
        throw new ExpressionError('unexpected-end', this.peek().start)
      }
      this.advance()
      if (args.length < builtin.minArgs || args.length > builtin.maxArgs) {
        throw new ExpressionError('wrong-argument-count', token.start, {
          name,
          expected: builtin.minArgs === builtin.maxArgs ? String(builtin.minArgs) : `${builtin.minArgs}-${builtin.maxArgs}`,
          actual: String(args.length),
        })
      }
      return { kind: 'call', name, args }
    }

    return { kind: 'variable', name }
  }
}

export type Scope = Record<string, number>

/** 快路径编译产物：位置参数闭包，批量求值零分配。 */
type CompiledNode = (params: Float64Array, x: number, y: number) => number

const RESERVED_VARIABLES = new Set(['x', 'y'])

export interface ParsedExpression {
  /** 表达式中出现的自由变量（含 x/y），已排序。 */
  variables: string[]
  /** 需要外部提供的参数名（variables 去掉 x/y），顺序与 evaluateInto 的 params 一致。 */
  parameterNames: string[]
  /** 慢路径：单点求值，允许按名传参。 */
  evaluate(scope: Scope): number
  /** 快路径：批量求值。x/y 可为 null，params 按 parameterNames 顺序。 */
  evaluateInto(
    x: Float64Array | null,
    y: Float64Array | null,
    params: Float64Array,
    out: Float64Array,
    length?: number,
  ): void
}

class Compiler {
  private readonly parameterIndex = new Map<string, number>()

  constructor(parameterNames: string[]) {
    parameterNames.forEach((name, index) => this.parameterIndex.set(name, index))
  }

  compile(node: AstNode): CompiledNode {
    switch (node.kind) {
      case 'number': {
        const value = node.value
        return () => value
      }
      case 'variable': {
        const constant = CONSTANTS[node.name]
        if (constant !== undefined) {
          return () => constant
        }
        if (node.name === 'x') {
          return (_params, x) => x
        }
        if (node.name === 'y') {
          return (_params, _x, y) => y
        }
        const index = this.parameterIndex.get(node.name) ?? -1
        return (params) => (index >= 0 ? params[index] : Number.NaN)
      }
      case 'unary': {
        const operand = this.compile(node.operand)
        if (node.op === '-') return (params, x, y) => -operand(params, x, y)
        if (node.op === '+') return (params, x, y) => +operand(params, x, y)
        return (params, x, y) => (operand(params, x, y) === 0 ? 1 : 0)
      }
      case 'binary':
        return this.compileBinary(node)
      case 'ternary': {
        const condition = this.compile(node.condition)
        const consequent = this.compile(node.consequent)
        const alternate = this.compile(node.alternate)
        return (params, x, y) => (condition(params, x, y) !== 0 ? consequent(params, x, y) : alternate(params, x, y))
      }
      case 'call': {
        const fn = BUILTIN_FUNCTIONS[node.name].fn
        const args = node.args.map((arg) => this.compile(arg))
        // 常见的一元/二元调用走专用快路径，避免每次展开数组。
        if (args.length === 1) {
          const a0 = args[0]
          return (params, x, y) => fn(a0(params, x, y))
        }
        if (args.length === 2) {
          const a0 = args[0]
          const a1 = args[1]
          return (params, x, y) => fn(a0(params, x, y), a1(params, x, y))
        }
        return (params, x, y) => fn(...args.map((arg) => arg(params, x, y)))
      }
    }
  }

  private compileBinary(node: Extract<AstNode, { kind: 'binary' }>): CompiledNode {
    const left = this.compile(node.left)
    const right = this.compile(node.right)

    switch (node.op) {
      case '+': return (p, x, y) => left(p, x, y) + right(p, x, y)
      case '-': return (p, x, y) => left(p, x, y) - right(p, x, y)
      case '*': return (p, x, y) => left(p, x, y) * right(p, x, y)
      case '/': return (p, x, y) => left(p, x, y) / right(p, x, y)
      case '%': return (p, x, y) => positiveMod(left(p, x, y), right(p, x, y))
      case '^': return (p, x, y) => left(p, x, y) ** right(p, x, y)
      case '==': return (p, x, y) => (left(p, x, y) === right(p, x, y) ? 1 : 0)
      case '~=': return (p, x, y) => (left(p, x, y) !== right(p, x, y) ? 1 : 0)
      case '<': return (p, x, y) => (left(p, x, y) < right(p, x, y) ? 1 : 0)
      case '<=': return (p, x, y) => (left(p, x, y) <= right(p, x, y) ? 1 : 0)
      case '>': return (p, x, y) => (left(p, x, y) > right(p, x, y) ? 1 : 0)
      case '>=': return (p, x, y) => (left(p, x, y) >= right(p, x, y) ? 1 : 0)
      case '&': return (p, x, y) => (left(p, x, y) !== 0 && right(p, x, y) !== 0 ? 1 : 0)
      case '|': return (p, x, y) => (left(p, x, y) !== 0 || right(p, x, y) !== 0 ? 1 : 0)
      case '&&': return (p, x, y) => (left(p, x, y) !== 0 && right(p, x, y) !== 0 ? 1 : 0)
      case '||': return (p, x, y) => (left(p, x, y) !== 0 || right(p, x, y) !== 0 ? 1 : 0)
    }
  }
}

export function collectVariables(node: AstNode, names = new Set<string>()): Set<string> {
  switch (node.kind) {
    case 'number':
      break
    case 'variable':
      if (CONSTANTS[node.name] === undefined) {
        names.add(node.name)
      }
      break
    case 'unary':
      collectVariables(node.operand, names)
      break
    case 'binary':
      collectVariables(node.left, names)
      collectVariables(node.right, names)
      break
    case 'ternary':
      collectVariables(node.condition, names)
      collectVariables(node.consequent, names)
      collectVariables(node.alternate, names)
      break
    case 'call':
      node.args.forEach((arg) => collectVariables(arg, names))
      break
  }
  return names
}

export function parseExpression(source: string): ParsedExpression {
  const trimmed = source.trim()
  if (!trimmed) {
    throw new ExpressionError('empty', 0)
  }

  const ast = new Parser(trimmed).parse()
  const variables = [...collectVariables(ast)].sort()
  const parameterNames = variables.filter((name) => !RESERVED_VARIABLES.has(name))
  const compiler = new Compiler(parameterNames)
  const compiled = compiler.compile(ast)

  const scratch = new Float64Array(parameterNames.length)

  const evaluate = (scope: Scope): number => {
    for (let i = 0; i < parameterNames.length; i += 1) {
      const value = scope[parameterNames[i]]
      scratch[i] = value === undefined ? Number.NaN : value
    }
    return compiled(scratch, scope.x ?? Number.NaN, scope.y ?? Number.NaN)
  }

  const evaluateInto: ParsedExpression['evaluateInto'] = (x, y, params, out, length) => {
    const count = length ?? out.length
    for (let i = 0; i < count; i += 1) {
      out[i] = compiled(params, x ? x[i] : Number.NaN, y ? y[i] : Number.NaN)
    }
  }

  return { variables, parameterNames, evaluate, evaluateInto }
}

export function formatCaretHint(source: string, position: number) {
  const leadingSpaces = source.length - source.trimStart().length
  const column = Math.min(Math.max(0, position) + leadingSpaces, 120)
  return `${' '.repeat(column)}^`
}

export { COMPARISON_OPERATORS, RESERVED_VARIABLES }

// ---------------------------------------------------------------------------
// 符号微分：为拟合提供解析雅可比（不支持导数的函数回退有限差分）。
// ---------------------------------------------------------------------------

const numNode = (value: number): AstNode => ({ kind: 'number', value })
const unaryNode = (op: '+' | '-' | '~', operand: AstNode): AstNode => ({ kind: 'unary', op, operand })
const binaryNode = (op: BinaryOperator, left: AstNode, right: AstNode): AstNode => ({ kind: 'binary', op, left, right })
const callNode = (name: string, args: AstNode[]): AstNode => ({ kind: 'call', name, args })
const ternaryNode = (condition: AstNode, consequent: AstNode, alternate: AstNode): AstNode => ({ kind: 'ternary', condition, consequent, alternate })

const ZERO = numNode(0)
const ONE = numNode(1)
const add = (a: AstNode, b: AstNode) => binaryNode('+', a, b)
const sub = (a: AstNode, b: AstNode) => binaryNode('-', a, b)
const mul = (a: AstNode, b: AstNode) => binaryNode('*', a, b)
const div = (a: AstNode, b: AstNode) => binaryNode('/', a, b)
const pow = (a: AstNode, b: AstNode) => binaryNode('^', a, b)

/** 对单个参数做符号微分；无法求导时返回 null（调用方回退有限差分）。 */
function derivativeOf(node: AstNode, target: string): AstNode | null {
  switch (node.kind) {
    case 'number':
      return ZERO
    case 'variable':
      if (CONSTANTS[node.name] !== undefined) return ZERO
      return node.name === target ? ONE : ZERO
    case 'unary': {
      if (node.op === '~') return ZERO
      const inner = derivativeOf(node.operand, target)
      if (!inner) return null
      return node.op === '-' ? unaryNode('-', inner) : inner
    }
    case 'ternary': {
      const consequent = derivativeOf(node.consequent, target)
      const alternate = derivativeOf(node.alternate, target)
      if (!consequent || !alternate) return null
      return ternaryNode(node.condition, consequent, alternate)
    }
    case 'binary':
      return derivativeBinary(node, target)
    case 'call':
      return derivativeCall(node, target)
  }
}

function derivativeBinary(node: Extract<AstNode, { kind: 'binary' }>, target: string): AstNode | null {
  const { left, right } = node
  switch (node.op) {
    case '+': {
      const a = derivativeOf(left, target); const b = derivativeOf(right, target)
      return a && b ? add(a, b) : null
    }
    case '-': {
      const a = derivativeOf(left, target); const b = derivativeOf(right, target)
      return a && b ? sub(a, b) : null
    }
    case '*': {
      const a = derivativeOf(left, target); const b = derivativeOf(right, target)
      return a && b ? add(mul(a, right), mul(left, b)) : null
    }
    case '/': {
      const a = derivativeOf(left, target); const b = derivativeOf(right, target)
      return a && b ? div(sub(mul(a, right), mul(left, b)), pow(right, numNode(2))) : null
    }
    case '%': {
      const a = derivativeOf(left, target); const b = derivativeOf(right, target)
      // mod(a, b) = a - b·floor(a/b)，忽略不连续点
      return a && b ? sub(a, mul(callNode('floor', [div(left, right)]), b)) : null
    }
    case '^': {
      const a = derivativeOf(left, target); const b = derivativeOf(right, target)
      if (right.kind === 'number') {
        return a ? mul(mul(numNode(right.value), pow(left, numNode(right.value - 1))), a) : null
      }
      if (left.kind === 'number') {
        return b ? mul(mul(pow(left, right), callNode('ln', [left])), b) : null
      }
      if (!a || !b) return null
      return mul(node, add(mul(b, callNode('ln', [left])), mul(right, div(a, left))))
    }
    default:
      // 比较 / 逻辑：几乎处处为常数
      return ZERO
  }
}

function chain(outerDerivative: (u: AstNode, du: AstNode) => AstNode, node: Extract<AstNode, { kind: 'call' }>, target: string): AstNode | null {
  const inner = node.args[0]
  const dInner = derivativeOf(inner, target)
  return dInner ? outerDerivative(inner, dInner) : null
}

function derivativeCall(node: Extract<AstNode, { kind: 'call' }>, target: string): AstNode | null {
  const name = node.name

  if (name === 'atan2' || name === 'hypot' || name === 'pow' || name === 'mod' || name === 'rem') {
    const [arg0, arg1] = node.args
    const d0 = derivativeOf(arg0, target)
    const d1 = derivativeOf(arg1, target)
    if (!d0 || !d1) return null
    if (name === 'atan2') {
      // atan2(y, x): (x·dy − y·dx) / (x² + y²)
      return div(sub(mul(arg1, d0), mul(arg0, d1)), add(pow(arg0, numNode(2)), pow(arg1, numNode(2))))
    }
    if (name === 'hypot') {
      return div(add(mul(arg0, d0), mul(arg1, d1)), node)
    }
    if (name === 'pow') {
      if (arg1.kind === 'number') {
        return mul(mul(numNode(arg1.value), pow(arg0, numNode(arg1.value - 1))), d0)
      }
      return mul(node, add(mul(d1, callNode('ln', [arg0])), mul(arg1, div(d0, arg0))))
    }
    // mod / rem ≈ a − b·floor(a/b)
    return sub(d0, mul(callNode('floor', [div(arg0, arg1)]), d1))
  }

  if (name === 'clamp') {
    const [value, low, high] = node.args
    const dValue = derivativeOf(value, target)
    if (!dValue) return null
    const within = binaryNode('&', binaryNode('>', value, low), binaryNode('<', value, high))
    return ternaryNode(within, dValue, ZERO)
  }

  if (node.args.length !== 1) {
    return null
  }

  switch (name) {
    case 'sin': return chain((u, du) => mul(callNode('cos', [u]), du), node, target)
    case 'cos': return chain((u, du) => unaryNode('-', mul(callNode('sin', [u]), du)), node, target)
    case 'tan': return chain((u, du) => mul(add(ONE, pow(callNode('tan', [u]), numNode(2))), du), node, target)
    case 'asin': return chain((u, du) => div(du, callNode('sqrt', [sub(ONE, pow(u, numNode(2)))])), node, target)
    case 'acos': return chain((u, du) => unaryNode('-', div(du, callNode('sqrt', [sub(ONE, pow(u, numNode(2)))]))), node, target)
    case 'atan': return chain((u, du) => div(du, add(ONE, pow(u, numNode(2)))), node, target)
    case 'sinh': return chain((u, du) => mul(callNode('cosh', [u]), du), node, target)
    case 'cosh': return chain((u, du) => mul(callNode('sinh', [u]), du), node, target)
    case 'tanh': return chain((u, du) => mul(sub(ONE, pow(callNode('tanh', [u]), numNode(2))), du), node, target)
    case 'ln': return chain((u, du) => div(du, u), node, target)
    case 'log': return chain((u, du) => div(du, u), node, target)
    case 'log2': return chain((u, du) => div(du, mul(u, numNode(Math.LN2))), node, target)
    case 'log10': return chain((u, du) => div(du, mul(u, numNode(Math.LN10))), node, target)
    case 'exp': return chain((u, du) => mul(callNode('exp', [u]), du), node, target)
    case 'sqrt': return chain((u, du) => div(du, mul(numNode(2), callNode('sqrt', [u]))), node, target)
    case 'cbrt': return chain((u, du) => div(du, mul(numNode(3), pow(callNode('cbrt', [u]), numNode(2)))), node, target)
    case 'abs': return chain((u, du) => mul(callNode('sign', [u]), du), node, target)
    case 'erf': return chain((u, du) => mul(numNode(2 / Math.sqrt(Math.PI)), mul(callNode('exp', [unaryNode('-', pow(u, numNode(2)))]), du)), node, target)
    case 'erfc': return chain((u, du) => unaryNode('-', mul(numNode(2 / Math.sqrt(Math.PI)), mul(callNode('exp', [unaryNode('-', pow(u, numNode(2)))]), du))), node, target)
    case 'deg2rad': return chain((_u, du) => mul(numNode(Math.PI / 180), du), node, target)
    case 'rad2deg': return chain((_u, du) => mul(numNode(180 / Math.PI), du), node, target)
    case 'heaviside':
    case 'floor':
    case 'ceil':
    case 'round':
    case 'fix':
    case 'sign':
      return ZERO
    default:
      // gamma / gammaln / sinc / factorial / min / max 等：回退有限差分
      return null
  }
}

export interface GradientExpression extends ParsedExpression {
  /** 第 index 个参数在某点处的偏导（批量写入 out）。 */
  gradientInto(
    index: number,
    x: Float64Array | null,
    y: Float64Array | null,
    params: Float64Array,
    out: Float64Array,
    length?: number,
  ): void
}

export function parseExpressionWithGradient(source: string): GradientExpression {
  const parsed = parseExpression(source)
  const trimmed = source.trim()
  const ast = new Parser(trimmed).parse()

  const gradientCompiled = parsed.parameterNames.map((name) => {
    const derivative = derivativeOf(ast, name)
    if (!derivative) {
      return null
    }
    return new Compiler(parsed.parameterNames).compile(derivative)
  })

  // 数值回退用的值闭包（与 parsed 同参数顺序）。
  const valueCompiled = new Compiler(parsed.parameterNames).compile(ast)

  const gradientInto: GradientExpression['gradientInto'] = (index, x, y, params, out, length) => {
    const count = length ?? out.length
    const gradient = gradientCompiled[index]

    if (gradient) {
      for (let i = 0; i < count; i += 1) {
        out[i] = gradient(params, x ? x[i] : Number.NaN, y ? y[i] : Number.NaN)
      }
      return
    }

    // 回退：中心差分
    const original = params[index]
    const step = 1e-6 * Math.max(1, Math.abs(original))
    params[index] = original + step
    for (let i = 0; i < count; i += 1) {
      out[i] = valueCompiled(params, x ? x[i] : Number.NaN, y ? y[i] : Number.NaN)
    }
    params[index] = original - step
    for (let i = 0; i < count; i += 1) {
      out[i] = (out[i] - valueCompiled(params, x ? x[i] : Number.NaN, y ? y[i] : Number.NaN)) / (2 * step)
    }
    params[index] = original
  }

  return { ...parsed, gradientInto }
}
