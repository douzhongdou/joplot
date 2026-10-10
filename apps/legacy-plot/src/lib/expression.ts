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

type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '^'
type OperatorToken = BinaryOperator | '(' | ')' | ','

type Token =
  | { type: 'number'; value: number; start: number; end: number }
  | { type: 'identifier'; name: string; start: number; end: number }
  | { type: 'operator'; op: OperatorToken; start: number; end: number }
  | { type: 'end'; start: number; end: number }

type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operand: AstNode }
  | { kind: 'binary'; op: BinaryOperator; left: AstNode; right: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }

export interface BuiltinFunction {
  fn: (...args: number[]) => number
  minArgs: number
  maxArgs: number
}

const BUILTIN_FUNCTIONS: Record<string, BuiltinFunction> = {
  sin: { fn: Math.sin, minArgs: 1, maxArgs: 1 },
  cos: { fn: Math.cos, minArgs: 1, maxArgs: 1 },
  tan: { fn: Math.tan, minArgs: 1, maxArgs: 1 },
  asin: { fn: Math.asin, minArgs: 1, maxArgs: 1 },
  acos: { fn: Math.acos, minArgs: 1, maxArgs: 1 },
  atan: { fn: Math.atan, minArgs: 1, maxArgs: 1 },
  atan2: { fn: Math.atan2, minArgs: 2, maxArgs: 2 },
  sinh: { fn: Math.sinh, minArgs: 1, maxArgs: 1 },
  cosh: { fn: Math.cosh, minArgs: 1, maxArgs: 1 },
  tanh: { fn: Math.tanh, minArgs: 1, maxArgs: 1 },
  ln: { fn: Math.log, minArgs: 1, maxArgs: 1 },
  log: {
    fn: (value: number, base?: number) => (base === undefined
      ? Math.log10(value)
      : Math.log(value) / Math.log(base)),
    minArgs: 1,
    maxArgs: 2,
  },
  log2: { fn: Math.log2, minArgs: 1, maxArgs: 1 },
  exp: { fn: Math.exp, minArgs: 1, maxArgs: 1 },
  sqrt: { fn: Math.sqrt, minArgs: 1, maxArgs: 1 },
  cbrt: { fn: Math.cbrt, minArgs: 1, maxArgs: 1 },
  abs: { fn: Math.abs, minArgs: 1, maxArgs: 1 },
  floor: { fn: Math.floor, minArgs: 1, maxArgs: 1 },
  ceil: { fn: Math.ceil, minArgs: 1, maxArgs: 1 },
  round: { fn: Math.round, minArgs: 1, maxArgs: 1 },
  sign: { fn: Math.sign, minArgs: 1, maxArgs: 1 },
  min: { fn: (...args: number[]) => Math.min(...args), minArgs: 2, maxArgs: 8 },
  max: { fn: (...args: number[]) => Math.max(...args), minArgs: 2, maxArgs: 8 },
  mod: { fn: (left: number, right: number) => ((left % right) + right) % right, minArgs: 2, maxArgs: 2 },
  pow: { fn: Math.pow, minArgs: 2, maxArgs: 2 },
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

  // An `e`/`E` only belongs to the number when digits (with optional sign) follow.
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

const MULTIPLY_ALIASES = new Set(['*', '·', '×'])
const DIVIDE_ALIASES = new Set(['/', '÷'])
const MINUS_ALIASES = new Set(['-', '−', '—'])
const COMMA_ALIASES = new Set([',', '，', '、'])

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  const pushOperator = (op: OperatorToken, at: number) => {
    tokens.push({ type: 'operator', op, start: at, end: at + 1 })
  }

  while (index < source.length) {
    const char = source[index]

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (MULTIPLY_ALIASES.has(char)) {
      pushOperator('*', index)
      index += 1
      continue
    }

    if (DIVIDE_ALIASES.has(char)) {
      pushOperator('/', index)
      index += 1
      continue
    }

    if (MINUS_ALIASES.has(char)) {
      pushOperator('-', index)
      index += 1
      continue
    }

    if (COMMA_ALIASES.has(char)) {
      pushOperator(',', index)
      index += 1
      continue
    }

    if (char === '+') {
      pushOperator('+', index)
      index += 1
      continue
    }

    if (char === '%') {
      pushOperator('%', index)
      index += 1
      continue
    }

    if (char === '^') {
      pushOperator('^', index)
      index += 1
      continue
    }

    if (char === '(' || char === '（') {
      pushOperator('(', index)
      index += 1
      continue
    }

    if (char === ')' || char === '）') {
      pushOperator(')', index)
      index += 1
      continue
    }

    if (char === '²' || char === '³') {
      pushOperator('^', index)
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

    throw new ExpressionError('unexpected-character', index, { token: char })
  }

  tokens.push({ type: 'end', start: source.length, end: source.length })
  return tokens
}

const BINDING_ADDITIVE = 1
const BINDING_MULTIPLICATIVE = 2
const BINDING_UNARY = 3
const BINDING_POWER = 4

function isBinaryOperator(op: OperatorToken): op is BinaryOperator {
  return op === '+' || op === '-' || op === '*' || op === '/' || op === '%' || op === '^'
}

function binaryBindingPower(op: BinaryOperator) {
  if (op === '+' || op === '-') {
    return BINDING_ADDITIVE
  }

  if (op === '^') {
    return BINDING_POWER
  }

  return BINDING_MULTIPLICATIVE
}

function describeToken(token: Token) {
  if (token.type === 'number') {
    return String(token.value)
  }

  if (token.type === 'identifier') {
    return token.name
  }

  if (token.type === 'operator') {
    return token.op
  }

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

      throw new ExpressionError('unexpected-token', trailing.start, {
        token: describeToken(trailing),
      })
    }

    return node
  }

  private parseExpression(minBindingPower: number): AstNode {
    let left = this.parsePrefix()

    for (;;) {
      const token = this.peek()

      if (token.type === 'operator' && isBinaryOperator(token.op)) {
        const bindingPower = binaryBindingPower(token.op)

        if (bindingPower < minBindingPower) {
          break
        }

        this.advance()
        const isRightAssociative = token.op === '^'
        const right = this.parseExpression(isRightAssociative ? bindingPower : bindingPower + 1)
        left = { kind: 'binary', op: token.op, left, right }
        continue
      }

      if (this.startsPrimary(token)) {
        if (BINDING_MULTIPLICATIVE < minBindingPower) {
          break
        }

        const right = this.parseExpression(BINDING_MULTIPLICATIVE + 1)
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

    if (this.isOperator(token, '-')) {
      this.advance()
      return { kind: 'unary', operand: this.parseExpression(BINDING_UNARY) }
    }

    if (this.isOperator(token, '+')) {
      this.advance()
      return this.parseExpression(BINDING_UNARY)
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
          expected: builtin.minArgs === builtin.maxArgs
            ? String(builtin.minArgs)
            : `${builtin.minArgs}-${builtin.maxArgs}`,
          actual: String(args.length),
        })
      }

      return { kind: 'call', name, args }
    }

    return { kind: 'variable', name }
  }
}

export type Scope = Record<string, number>
export type CompiledExpression = (scope: Scope) => number

function compileNode(node: AstNode): CompiledExpression {
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

      const name = node.name
      return (scope) => scope[name] ?? Number.NaN
    }
    case 'unary': {
      const operand = compileNode(node.operand)
      return (scope) => -operand(scope)
    }
    case 'call': {
      const fn = BUILTIN_FUNCTIONS[node.name]
      const args = node.args.map(compileNode)

      return (scope) => fn.fn(...args.map((arg) => arg(scope)))
    }
    case 'binary': {
      const left = compileNode(node.left)
      const right = compileNode(node.right)

      switch (node.op) {
        case '+':
          return (scope) => left(scope) + right(scope)
        case '-':
          return (scope) => left(scope) - right(scope)
        case '*':
          return (scope) => left(scope) * right(scope)
        case '/':
          return (scope) => left(scope) / right(scope)
        case '%': {
          const modFn = BUILTIN_FUNCTIONS.mod.fn
          return (scope) => modFn(left(scope), right(scope))
        }
        case '^':
          return (scope) => left(scope) ** right(scope)
      }
    }
  }
}

export interface ParsedExpression {
  evaluate: CompiledExpression
  variables: string[]
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

  return {
    evaluate: compileNode(ast),
    variables,
  }
}

export function formatCaretHint(source: string, position: number) {
  const leadingSpaces = source.length - source.trimStart().length
  const column = Math.min(Math.max(0, position) + leadingSpaces, 120)

  return `${' '.repeat(column)}^`
}
