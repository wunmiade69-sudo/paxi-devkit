const TOKEN = /\s*(\(|\)|AND\b|OR\b|WITH\b|(?:DocumentRef-[A-Za-z0-9.-]+:)?(?:LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.+-]*))/gy;
const OPS = new Set(['AND', 'OR', 'WITH']);

export function tokenizeSpdxExpression(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('SPDX license expression must be a non-empty string of at most 2048 characters.');
  const source = value.trim();
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(source);
    if (!match || match.index !== index) throw new Error(`Invalid SPDX expression token near character ${index + 1}.`);
    tokens.push(match[1]);
    index = TOKEN.lastIndex;
  }
  if (!tokens.length) throw new Error('SPDX license expression is empty.');
  return tokens;
}

export function parseSpdxExpression(value) {
  const tokens = tokenizeSpdxExpression(value);
  let cursor = 0;
  const peek = () => tokens[cursor] ?? null;
  const take = () => tokens[cursor++];
  const isOperator = (value, operator) => String(value || '').toUpperCase() === operator;
  const isIdentifier = (value) => Boolean(value && !['(', ')'].includes(value) && !OPS.has(value.toUpperCase()));

  function primary() {
    if (peek() === '(') {
      take();
      const expression = parseOr();
      if (take() !== ')') throw new Error('SPDX expression has an unclosed parenthesis.');
      return expression;
    }
    const id = take();
    if (!isIdentifier(id)) throw new Error('SPDX expression expected a license identifier.');
    return { type: 'license', id };
  }

  function withExpression() {
    const left = primary();
    if (isOperator(peek(), 'WITH')) {
      take();
      if (left.type !== 'license') throw new Error('SPDX WITH must follow a single license identifier, not a parenthesized or compound expression.');
      const exception = take();
      if (!isIdentifier(exception)) throw new Error('SPDX WITH requires an exception identifier.');
      return { type: 'with', license: left.id, exception };
    }
    return left;
  }

  function parseAnd() {
    let node = withExpression();
    while (isOperator(peek(), 'AND')) {
      take();
      node = { type: 'and', left: node, right: withExpression() };
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (isOperator(peek(), 'OR')) {
      take();
      node = { type: 'or', left: node, right: parseAnd() };
    }
    return node;
  }

  const ast = parseOr();
  if (cursor !== tokens.length) throw new Error(`Unexpected SPDX expression token '${tokens[cursor]}'.`);
  return ast;
}

export function collectSpdxIdentifiers(ast, output = { licenses: [], exceptions: [] }) {
  if (!ast || typeof ast !== 'object') return output;
  if (ast.type === 'license') output.licenses.push(ast.id);
  else if (ast.type === 'with') { output.licenses.push(ast.license); output.exceptions.push(ast.exception); }
  else if (ast.type === 'and' || ast.type === 'or') {
    collectSpdxIdentifiers(ast.left, output);
    collectSpdxIdentifiers(ast.right, output);
  }
  return { licenses: [...new Set(output.licenses)], exceptions: [...new Set(output.exceptions)] };
}
