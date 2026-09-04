import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseService } from '../dist/baseService.js';
import { PrismaMetaMapper } from '../dist/prismaMetaMapper.js';

test('preserves Prisma entity names that contain Model', () => {
  const repository = {};

  assert.equal(PrismaMetaMapper.normalizeEntityName('RvcVoiceModelModel'), 'RvcVoiceModel');
  assert.equal(new BaseService('RvcVoiceModel', { rvcVoiceModel: repository }).modelName, 'rvcVoiceModel');
  assert.equal(new BaseService('RvcVoiceModelModel', { rvcVoiceModel: repository }).modelName, 'rvcVoiceModel');
});

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
