import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpdxExpression, collectSpdxIdentifiers } from '../src/doctor/spdx-expression.mjs';

test('SPDX parser honours AND precedence over OR and parentheses', () => {
  const ast = parseSpdxExpression('MIT OR Apache-2.0 AND BSD-3-Clause');
  assert.equal(ast.type, 'or');
  assert.equal(ast.right.type, 'and');
  const grouped = parseSpdxExpression('(MIT OR Apache-2.0) AND BSD-3-Clause');
  assert.equal(grouped.type, 'and');
  assert.equal(grouped.left.type, 'or');
});

test('SPDX parser supports WITH exceptions and document/local LicenseRefs', () => {
  const ast = parseSpdxExpression('GPL-2.0-only WITH Classpath-exception-2.0 AND DocumentRef-upstream:LicenseRef-custom');
  const ids = collectSpdxIdentifiers(ast);
  assert.deepEqual(ids.licenses, ['GPL-2.0-only', 'DocumentRef-upstream:LicenseRef-custom']);
  assert.deepEqual(ids.exceptions, ['Classpath-exception-2.0']);
});

test('SPDX parser rejects malformed operators, missing groups and trailing tokens', () => {
  for (const expression of ['MIT AND', 'MIT OR OR Apache-2.0', '(MIT OR Apache-2.0', 'MIT WITH', 'MIT Apache-2.0', 'MIT & Apache-2.0']) {
    assert.throws(() => parseSpdxExpression(expression), undefined, expression);
  }
});
