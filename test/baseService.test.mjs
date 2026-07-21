import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseService } from '../dist/baseService.js';

test('getAll counts models without an id field', async () => {
  let aggregateArgs;
  const repository = {
    aggregate: async (args) => {
      aggregateArgs = args;
      return { _count: { _all: 2 } };
    },
    findMany: async () => [{ identityKey: 'user:1' }, { identityKey: 'ip:abc' }]
  };
  const service = new BaseService('QuotaModel', { quota: repository });

  const result = await service.getAll({
    filters: [],
    fields: ['identityKey'],
    orderBy: { identityKey: 'asc' },
    offset: 0,
    limit: 10
  });

  assert.deepEqual(aggregateArgs._count, { _all: true });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items, [{ identityKey: 'user:1' }, { identityKey: 'ip:abc' }]);
});
