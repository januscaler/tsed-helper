import { OnInit } from '@tsed/di';
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
		return _.camelCase(_.split(this.tsedPrismaModelName, 'Model')[0]) as string;
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
