import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BaseService } from '../dist/baseService.js';
import { PrismaMetaMapper } from '../dist/prismaMetaMapper.js';

const SCHEMA = fileURLToPath(new URL('./fixtures/searchFields.prisma', import.meta.url));

/** A BaseService wired to the fixture schema, recording the args Prisma would receive. */
async function makeService(tsedModelName, prismaKey) {
	const calls = [];
	const repository = {
		aggregate: async () => ({ _count: { _all: 0 } }),
		findMany: async (args) => {
			calls.push(args);
			return [];
		}
	};
	const service = new BaseService(tsedModelName, { [prismaKey]: repository }, SCHEMA);
	await service.$onInit();
	return { service, calls };
}

const search = (fields) => ({ filters: [], fields, orderBy: { id: 'desc' }, offset: 0, limit: 50 });

beforeEach(() => PrismaMetaMapper.invalidateCache());

test('rejects a relation that the model does not have', async () => {
	const { service, calls } = await makeService('ExternalApiModel', 'externalApi');

	// The exact payload the four product admin pages send.
	await assert.rejects(
		() => service.getAll(search(['id', 'name', 'description', 'permissions.id', 'permissions.name', 'permissions.permissionUid'])),
		(err) => {
			assert.equal(err.status, 400);
			assert.match(err.message, /ExternalApi has no field named "permissions"/);
			assert.match(err.message, /Selectable fields: id, name, description, host, apiSettings, isActive\./);
			return true;
		}
	);
	assert.equal(calls.length, 0, 'the invalid query must never reach Prisma');
});

test('still selects a relation the model does have', async () => {
	const { service, calls } = await makeService('ExternalUserModel', 'externalUser');

	await service.getAll(search(['id', 'permissions.id', 'permissions.name', 'permissions.permissionUid']));

	assert.deepEqual(calls[0].select, {
		id: true,
		permissions: { select: { id: true, name: true, permissionUid: true } }
	});
});

test('rejects an unknown scalar', async () => {
	const { service } = await makeService('ExternalApiModel', 'externalApi');

	await assert.rejects(
		() => service.getAll(search(['id', 'nmae'])),
		(err) => {
			assert.equal(err.status, 400);
			assert.match(err.message, /"nmae" — ExternalApi has no field named "nmae"/);
			return true;
		}
	);
});

test('rejects an unknown column on a real relation', async () => {
	const { service } = await makeService('ExternalUserModel', 'externalUser');

	await assert.rejects(
		() => service.getAll(search(['id', 'permissions.nope'])),
		(err) => {
			assert.equal(err.status, 400);
			assert.match(err.message, /"permissions.nope" — Permission has no column named "nope"/);
			return true;
		}
	);
});

test('rejects dotted access through a scalar column', async () => {
	const { service } = await makeService('ExternalApiModel', 'externalApi');

	await assert.rejects(
		() => service.getAll(search(['id', 'apiSettings.provider'])),
		(err) => {
			assert.equal(err.status, 400);
			assert.match(err.message, /"apiSettings" is a Json column, not a relation/);
			return true;
		}
	);
});

test('lets computed fields through', async () => {
	const { service, calls } = await makeService('ExternalApiModel', 'externalApi');
	service.computedFields = [{ name: 'isConfigured', needs: ['host'], compute: (row) => Boolean(row.host), type: 'boolean' }];

	const result = await service.getAll(search(['id', 'isConfigured']));

	assert.deepEqual(calls[0].select, { id: true, host: true });
	assert.deepEqual(result.items, []);
});

test('lets `extend()` fields through', async () => {
	// `extend()` registers a Prisma `$extends` result field: real to Prisma, absent
	// from the DMMF, and NOT in `computedFields`. Rejecting it 400s a working page.
	const calls = [];
	const repository = {
		aggregate: async () => ({ _count: { _all: 0 } }),
		findMany: async (args) => {
			calls.push(args);
			return [];
		}
	};
	const prismaService = { externalApi: repository, $extends: () => prismaService };
	const service = new BaseService('ExternalApiModel', prismaService, SCHEMA);
	await service.$onInit();
	service.extend({ greeting: { needs: { id: true }, compute: (row) => `hi-${row.name}` } });

	await service.getAll(search(['id', 'greeting']));

	assert.deepEqual(calls[0].select, { id: true, greeting: true });
	assert.ok(service.selectableFields.includes('greeting'));
});

test('skips validation when schema metadata is unavailable', async () => {
	const calls = [];
	const repository = {
		aggregate: async () => ({ _count: { _all: 0 } }),
		findMany: async (args) => {
			calls.push(args);
			return [];
		}
	};
	// No $onInit — tablesInfo stays empty, so Prisma remains the judge of what is selectable.
	const service = new BaseService('ExternalApiModel', { externalApi: repository }, SCHEMA);

	await service.getAll(search(['id', 'permissions.id']));

	assert.deepEqual(calls[0].select, { id: true, permissions: { select: { id: true } } });
});
