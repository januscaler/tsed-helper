import { OnInit } from '@tsed/di';
import { BadRequest } from '@tsed/exceptions';
import _ from 'lodash';
import { SearchParams } from './baseCrud.js';
import { Subject } from 'rxjs';
import { PrismaMapperEntity, PrismaMapperEntityField, PrismaMetaMapper } from './prismaMetaMapper.js'
import { Generics } from '@tsed/schema';
import { SearchFilterRecord } from './types.js';
import { filterMappers } from './filterMappers.js';
import { buildPayloadWithRelations } from './relationPayload.js';
import {
	splitSearchParams,
	buildSelect,
	buildOrderBy,
	applyComputedFilters,
	applyComputedSort,
	paginate,
	attachComputedFields,
	type ComputedFieldDefinition,
	type SplitResult,
} from './searchHelpers.js';

const MAX_IN_MEMORY = 10_000;

export interface IBaseService<M> {
	onPostUpdate: Subject<{ id: number, inputData: M, result: any }>
	onPreUpdate?: Subject<{ id: number, inputData: M }>
	onPreDelete?: Subject<{ id: number }>
	onPostDelete: Subject<{ id: number, result: any }>
	onPreCreate?: Subject<{ data: M }>
	onPostCreate: Subject<{ data: M, result: any }>
}
export type RelationMapper = {
	relationvalueMapper?: (fieldName: string, value: any) => any
}

export interface CreateRelationMapper extends RelationMapper {
	relationOperation?: 'connect' | 'connectOrCreate' | 'create' | 'createMany'
}

export interface UpdateRelationMapper extends RelationMapper {
	relationOperation?: 'set' | 'disconnect' | 'delete' | 'connect' | 'disconnectMany' | 'deleteMany' | 'create' | 'createMany' | 'update' | 'updateMany' | 'upsert' | 'upsertMany'
}

@Generics("T", "M")
export class BaseService<T, M> implements OnInit, IBaseService<M> {
	constructor(public tsedPrismaModelName: any, private prismaService: any, relativePrismaFilePath?: string) {
		this.prismaFilePath = relativePrismaFilePath ?? "./prisma/schema.prisma"
	}

	public prismaFilePath: string
	tablesInfo: Record<string, PrismaMapperEntity> = {}

	computedFields: ComputedFieldDefinition[] = [];

	/**
	 * Field names registered through `extend()`. Prisma resolves these at query time
	 * via `$extends`, so they are selectable — but they come from no `.prisma` file
	 * and are absent from the DMMF, so `assertSelectableFields` has to be told.
	 */
	prismaExtendedFields: Set<string> = new Set();

	static readonly MODES = {
		EQ: 'EQ', EX: 'EX', LT: 'LT', GT: 'GT', LTE: 'LTE', GTE: 'GTE', EM: 'EM', NEM: 'NEM', RG: 'RG',
	} as const;

	onPostUpdate: Subject<{ id: number, inputData: M, result: any }> = new Subject()
	onPreUpdate?: Subject<{ id: number; inputData: M; }> = new Subject()
	onPreDelete?: Subject<{ id: number }> = new Subject()
	onPreCreate?: Subject<{ data: M }> = new Subject();
	onPostCreate: Subject<{ data: M, result: any }> = new Subject()
	onPostDelete: Subject<{ id: number, result: any }> = new Subject()

	get repository() {
		return this.prismaService[this.modelName] as T;
	}

	get modelName() {
		const exactModelName = _.camelCase(this.tsedPrismaModelName) as string;
		if (this.prismaService[exactModelName]) return exactModelName;
		return _.camelCase(String(this.tsedPrismaModelName).replace(/Model$/, '')) as string;
	}

	get fieldNames() {
		if ((this.repository as any)?.collection) {
			return Object.keys((this.repository as any).collection.fields)
		}
		else if ((this.repository as any)?.fields) {
			return Object.keys((this.repository as any).fields)
		}
		throw new Error('repository has no fields, probably you passed wrong repository');
	}

	get currentModelInfo() {
		return this.tablesInfo[_.upperFirst(this.modelName)]
	}

	get currentModelFieldsMapping() {
		const { fields } = this.currentModelInfo
		return _.transform(fields, (result, field) => {
			result[field.name] = field;
		}, {}) as Record<string, PrismaMapperEntityField>
	}

	extend<M>(computedFields: Record<string, {
		needs: Partial<Record<keyof M, boolean>>
		compute: (model: M) => any
	}>) {
		for (const name of Object.keys(computedFields)) this.prismaExtendedFields.add(name);
		this.prismaService = this.prismaService.$extends({
			result: {
				[this.modelName]: computedFields as any
			}
		})
	}

	async $onInit(): Promise<any> {
		PrismaMetaMapper.relativePrismaFilePath = this.prismaFilePath
		this.tablesInfo = await PrismaMetaMapper.getTablesInfo()
	}

	async update(id: number, data: any, { relationOperation, relationvalueMapper }: UpdateRelationMapper = { relationOperation: 'set' }, tx?: any) {
		const repo = tx ?? this.repository;
		this.onPreUpdate?.next({ id, inputData: data });
		const finalData = buildPayloadWithRelations(data, this.fieldNames, relationOperation ?? 'set', relationvalueMapper);
		const result = await (repo as any).update({ where: { id }, data: finalData });
		this.onPostUpdate.next({ id, inputData: data, result });
		return result;
	}

	async create(data: M, { relationOperation, relationvalueMapper }: CreateRelationMapper = { relationOperation: 'connect' }, tx?: any) {
		const repo = tx ?? this.repository;
		this.onPreCreate?.next({ data });
		const finalData = buildPayloadWithRelations(data as any, this.fieldNames, relationOperation ?? 'connect', relationvalueMapper);
		const result = await (repo as any).create({ data: finalData });
		this.onPostCreate.next({ data, result });
		return result;
	}

	async deleteItem(id: number, tx?: any) {
		const repo = tx ?? this.repository;
		this.onPreDelete?.next({ id });
		const result = await (repo as any).delete({ where: { id }, select: { id: true } });
		this.onPostDelete.next({ id, result });
		return result;
	}

	async getOne(id: number) {
		return (await (this.repository as any).findFirst({ where: { id } })) ?? null;
	}

	async getManyByIds(ids: number[], select?: Record<string, boolean>) {
		return (this.repository as any).findMany({ where: { id: { in: ids } }, ...(select ? { select } : {}) });
	}

	async count(where?: Record<string, any>): Promise<number> {
		return (this.repository as any).count({ where: where ?? {} });
	}

	async exists(id: number): Promise<boolean> {
		const r = await (this.repository as any).findFirst({ where: { id }, select: { id: true } });
		return r != null;
	}

	async upsert(where: Record<string, any>, create: Record<string, any>, update: Record<string, any>) {
		return (this.repository as any).upsert({ where, create, update });
	}

	/**
	 * Every name a `fields[]` entry may carry: scalars, relations (bare or
	 * `relation.column`), in-memory computed fields, and `extend()` fields.
	 * Empty when schema metadata has not loaded.
	 */
	get selectableFields(): string[] {
		const modelInfo = this.currentModelInfo;
		if (!modelInfo) return [];
		const scalars: string[] = [];
		const relations: string[] = [];
		for (const field of modelInfo.fields) {
			if (!field.relationName) {
				scalars.push(field.name);
				continue;
			}
			const related = this.tablesInfo[field.type];
			if (!related) continue;
			for (const relatedField of related.fields) {
				if (!relatedField.relationName) relations.push(`${field.name}.${relatedField.name}`);
			}
		}
		return [...scalars, ...relations, ...this.computedFields.map((def) => def.name), ...this.prismaExtendedFields];
	}

	/**
	 * Reject a `fields[]` entry the model cannot select before it reaches Prisma.
	 * Prisma raises `PrismaClientValidationError` for an unknown field, which is not
	 * an HttpException, so the client sees an opaque 500 for what is a malformed
	 * request. Fail closed with the offending field named instead.
	 */
	protected assertSelectableFields(fields: string[]) {
		if (!fields?.length) return;
		const modelInfo = this.currentModelInfo;
		if (!modelInfo) return; // schema metadata unavailable — leave validation to Prisma
		const fieldsByName = this.currentModelFieldsMapping;
		const computedNames = new Set(this.computedFields.map((def) => def.name));

		const problems = _.flatMap(fields, (field) => {
			const [root, column, ...rest] = field.split('.');
			if (computedNames.has(root) || this.prismaExtendedFields.has(root)) return [];
			const rootField = fieldsByName[root];
			if (!rootField) return [`"${field}" — ${modelInfo.name} has no field named "${root}"`];
			if (column === undefined) return [];
			if (rest.length) return [`"${field}" — only one level of relation nesting is supported`];
			if (!rootField.relationName) return [`"${field}" — "${root}" is a ${rootField.type} column, not a relation`];
			const related = this.tablesInfo[rootField.type];
			if (related && !related.fields.some((f) => f.name === column && !f.relationName)) {
				return [`"${field}" — ${rootField.type} has no column named "${column}"`];
			}
			return [];
		});

		if (!problems.length) return;
		throw new BadRequest(
			`Invalid "fields" for ${modelInfo.name}: ${problems.join('; ')}. Selectable fields: ${this.selectableFields.join(', ')}.`,
		);
	}

	protected modeToPrismaFilter(filters: SearchFilterRecord): Record<string, any> {
		return _.transform(filters, (out: Record<string, any>, filter, fieldName) => {
			const mapper = filterMappers[filter.mode];
			if (!mapper) throw new Error(`Unsupported filter mode: ${filter.mode}`);
			const fieldInfo = this.currentModelFieldsMapping[fieldName];
			if (!fieldInfo) throw new Error(`Unknown field "${fieldName}" on ${this.modelName}. Register as computedField or fix the filter.`);
			mapper(out, filter.value, fieldName, fieldInfo, filter.isRelation ?? false);
		}, {});
	}

	protected filtersToPrismaOrCondition(filters: SearchFilterRecord[]): Record<string, any> {
		if (!filters?.length) return {};
		const orGroups = filters
			.map((f) => this.modeToPrismaFilter(f))
			.filter((g) => g && Object.keys(g).length > 0);
		return orGroups.length > 0 ? { OR: orGroups } : {};
	}

	async getAll({ filters, offset, limit, fields, orderBy, countTotal = true }: SearchParams) {
		const requestedFields = fields ?? [];
		this.assertSelectableFields(requestedFields);
		const split = splitSearchParams({ filters, fields, orderBy }, this.computedFields);
		const hasComputedWork = split.computedFilters.length > 0 || Object.keys(split.computedOrderBy).length > 0;

		const prismaWhere = this.filtersToPrismaOrCondition(split.prismaFilters);
		const select = buildSelect(split.prismaFields);
		const prismaOrderBy = buildOrderBy(split.prismaOrderBy);

		if (!hasComputedWork) {
			return this._searchFastPath(prismaWhere, select, prismaOrderBy, offset, limit, countTotal, split, requestedFields);
		}
		return this._searchInMemory(prismaWhere, select, prismaOrderBy, offset, limit, split, requestedFields);
	}

	private async _searchFastPath(
		prismaWhere: any,
		select: Record<string, unknown> | undefined,
		prismaOrderBy: any[],
		offset: number,
		limit: number,
		countTotal: boolean,
		split: SplitResult,
		requestedFields: string[],
	) {
		const query = { skip: offset, take: limit, orderBy: prismaOrderBy, where: prismaWhere, ...(select ? { select } : {}) };
		const total = countTotal ? await this._countTotal(prismaWhere) : 0;
		const items = await (this.repository as any).findMany(query);
		const enriched = await attachComputedFields(items, split.activeComputedDefs, requestedFields);
		return { total, items: enriched };
	}

	private async _searchInMemory(
		prismaWhere: any,
		select: Record<string, unknown> | undefined,
		prismaOrderBy: any[],
		offset: number,
		limit: number,
		split: SplitResult,
		requestedFields: string[],
	) {
		const defByName = new Map(this.computedFields.map((d) => [d.name, d] as [string, ComputedFieldDefinition]));
		const query = { skip: 0, take: MAX_IN_MEMORY, orderBy: prismaOrderBy, where: prismaWhere, ...(select ? { select } : {}) };

		const allItems = await (this.repository as any).findMany(query);
		const filtered = applyComputedFilters(allItems, split.computedFilters, defByName);
		const sorted = applyComputedSort(filtered, split.computedOrderBy, defByName);
		const paged = paginate(sorted, offset ?? 0, limit ?? 20);
		const enriched = await attachComputedFields(paged, split.activeComputedDefs, requestedFields);

		return { total: filtered.length, items: enriched };
	}

	private async _countTotal(prismaWhere: any): Promise<number> {
		const { _count: { _all } } = await (this.repository as any).aggregate({ where: prismaWhere, _count: { _all: true } });
		return _all;
	}
}
