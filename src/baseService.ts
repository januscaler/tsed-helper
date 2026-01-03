import { OnInit } from '@tsed/di';
import _ from 'lodash';
import { SearchParams } from './baseCrud.js';
import { Subject } from 'rxjs';
import { PrismaMapperEntity, PrismaMapperEntityField, PrismaMetaMapper } from './prismaMetaMapper.js'
import { Generics } from '@tsed/schema';
import { SearchFilterRecord, SearchFilterValue } from './types.js';

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
	/**
 * Service configuration options.
 *
 * @property {string} tsedPrismaModelName - A valid Prisma model name required for this service.
 * @property {PrismaService} prismaService - An instance of the PrismaService used for computations and extensions.
 * @property {string} [relativePrismaFilePath="./prisma/schema.prisma"] - Optional path to the Prisma schema file. Defaults to "./prisma/schema.prisma".
 */
	constructor(public tsedPrismaModelName: any, private prismaService: any, relativePrismaFilePath?: string) {
		this.prismaFilePath = relativePrismaFilePath ?? "./prisma/schema.prisma"
	}

	public prismaFilePath: string
	tablesInfo: Record<string, PrismaMapperEntity> = {}

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
		// @ts-ignore
		if ((this.repository as any)?.collection) {
			// @ts-ignore
			return Object.keys((this.repository as any).collection.fields)
		}
		// @ts-ignore
		else if ((this.repository as any)?.fields) {
			// @ts-ignore
			return Object.keys((this.repository as any).fields)
		}
		throw new Error('repository has no fields, probably you passed wrong repository');
	}


	get currentModelInfo() {
		// coz it is stored with uppercase first letter
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
		const prismaMapper = new PrismaMetaMapper(this.prismaFilePath)
		this.tablesInfo = await prismaMapper.getTablesInfo()
	}

	/**
	 * Updates the current Prisma model record and optionally rewrites relation fields in one call.
	 *
	 * @param id Record identifier passed to the Prisma `where` clause.
	 * @param data Plain object that can mix scalar fields (written directly) and relation fields (handled via Prisma relation operations).
	 * @param options.relationOperation Prisma relation operation (`set`, `connect`, `disconnectMany`, etc.) applied to every relation key found in `data`. Defaults to `set`.
	 * @param options.relationvalueMapper Optional transformer that receives each relation value from `data` before it is sent to Prisma. Use it to build compound keys, wrap payloads, or handle `connectOrCreate` inputs.
	 *
	 * @example
	 * // Replace the existing tags with two tag ids while mapping the ids to Prisma connect objects.
	 * await service.update(42, { title: 'Draft', tags: [1, 2] }, {
	 *   relationOperation: 'set',
	 *   relationvalueMapper: (ids) => ids.map((id) => ({ id })),
	 * });
	 *
	 * @example
	 * // Append comments by turning each comment payload into a Prisma create object.
	 * await service.update(42, { comments: [{ text: 'Nice!' }] }, {
	 *   relationOperation: 'createMany',
	 *   relationvalueMapper: (comments) => ({ data: comments }),
	 * });
	 */
	async update(id: number, data: any, { relationOperation, relationvalueMapper }: UpdateRelationMapper = { relationOperation: 'set' }) {
		const defaultRelationValueMapper = (value: any) => (_.isArray(value) ? _.map(value, (id: any) => ({ id })) : { id: value })
		const dataWithRelations = _.pick(data, this.fieldNames)
		const relationData = _.omit(data, this.fieldNames)
		const finalData = _.transform(relationData, (result, value, key) => {
			if (_.isNil(value)) {
				return
			}
			if (!relationvalueMapper) {
				result[key] = { [relationOperation]: defaultRelationValueMapper(value) }
				return;
			}
			const relationvalue = relationvalueMapper(key, value)
			if (_.isNil(relationvalue)) {
				return
			}
			result[key] = { [relationOperation]: relationvalue }
		}, {
			...dataWithRelations
		})
		this.onPreUpdate?.next({ id, inputData: data });
		const result = await (this.repository as any).update({ where: { id }, data: finalData });
		this.onPostUpdate.next({ id, inputData: data, result });
		return result;
	}

	/**
	 * Creates a Prisma model record while optionally performing relation writes in the same call.
	 *
	 * @param data Plain object that can mix scalar columns and relation fields destined for Prisma create operations.
	 * @param options.relationOperation Prisma relation operation (`connect`, `connectOrCreate`, `create`, `createMany`) applied to every relation key from `data`. Defaults to `connect`.
	 * @param options.relationvalueMapper Optional transformer invoked per relation value from `data` before passing it to Prisma. Ideal for wrapping ids in `connect` objects or preparing nested `create` payloads.
	 *
	 * @example
	 * // Create a post and connect it with existing tag ids.
	 * await service.create({ title: 'Draft', tags: [1, 2] }, {
	 *   relationOperation: 'connect',
	 *   relationvalueMapper: (field,ids) => ids.map((id) => ({ id })),
	 * });
	 *
	 * @example
	 * // Create a post with newly created comments in one transaction.
	 * await service.create({ title: 'Draft', comments: [{ text: 'Nice!' }] }, {
	 *   relationOperation: 'createMany',
	 *   relationvalueMapper: (field,comments) => ({ data: comments }),
	 * });
	 */
	async create(data: M, { relationOperation, relationvalueMapper }: CreateRelationMapper = { relationOperation: 'connect' }) {
		this.onPreCreate?.next({ data });
		const defaultRelationValueMapper = (value: any) => (_.isArray(value) ? _.map(value, (id: any) => ({ id })) : { id: value })
		const dataWithRelations = _.pick(data, this.fieldNames)
		const relationData = _.omit(data as any, this.fieldNames)
		const finalData = _.transform(relationData, (result, value, key) => {
			if (_.isNil(value)) {
				return
			}
			if (!relationvalueMapper) {
				result[key] = { [relationOperation]: defaultRelationValueMapper(value) }
				return;
			}
			const relationvalue = relationvalueMapper(key, value)
			if (_.isNil(relationvalue)) {
				return
			}
			result[key] = { [relationOperation]: relationvalue }
		}, {
			...dataWithRelations
		})
		const result = await (this.repository as any).create({ data: finalData });
		this.onPostCreate.next({ data, result });
		return result;
	}

	async deleteItem(id: number) {
		this.onPreDelete?.next({ id });
		const result = await (this.repository as any).delete({ where: { id }, select: { id: true } });
		this.onPostDelete.next({ id, result });
		return result;
	}

	async getOne(id: number) {
		return (await (this.repository as any).findFirst({ where: { id } })) || {};
	}



	readonly MODES = {
		EQ: 'EQ',
		EX: 'EX',
		LT: 'LT',
		GT: 'GT',
		LTE: 'LTE',
		GTE: 'GTE',
		EM: 'EM',
		NEM: 'NEM',
		RG: 'RG'
	};

	protected modeToTypeMappers: Record<string, (prismaFilters: any, value: any, fieldName: string, fieldInfo: any, isRelation: boolean) => void> = {
		EM: (prismaFilters: any, value: any, fieldName: string, fieldInfo: any, isRelation: boolean) => {
			if (fieldInfo.type === 'Int' && !fieldInfo.isRequired) {
				_.set(prismaFilters, `${fieldName}`, null);
			}

			if (fieldInfo.type === 'String' && !fieldInfo.isRequired) {
				_.set(prismaFilters, `${fieldName}`, null);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${fieldName}`, null);
			}
		},
		EQ: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (fieldInfo.type === 'Int') {
				_.set(prismaFilters, `${propertyName}.equals`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
					const start = new Date(value);
					const end = new Date(start);
					end.setDate(start.getDate() + 1);
					_.set(prismaFilters, `${propertyName}.gte`, start);
					_.set(prismaFilters, `${propertyName}.lt`, end);
				} else {
					_.set(prismaFilters, `${propertyName}.equals`, new Date(value));
				}
			}
			if (_.isArray(value)) {
				if (isRelation) {
					_.set(prismaFilters, `${propertyName}.some.id.in`, value);
				} else {
					_.set(prismaFilters, `${propertyName}.in`, value);
				}
			}
			if (fieldInfo.type === 'String') {
				_.set(prismaFilters, `${propertyName}.contains`, value);
				_.set(prismaFilters, `${propertyName}.mode`, 'insensitive');
			}
		},
		EX: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.not.equals`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.not.equals`, value);
			}
			if (_.isArray(value)) {
				if (isRelation) {
					_.set(prismaFilters, `${propertyName}.none.id.in`, value);
				} else {
					_.set(prismaFilters, `${propertyName}.not.in`, value);
				}
			}
			if (_.isString(value)) {
				_.set(prismaFilters, `${propertyName}.not.contains`, value);
			}
		},
		LT: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.lt`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.lt`, new Date(value));
			}
		},
		LTE: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.lte`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.lte`, new Date(value));
			}
		},
		GT: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.gt`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.gt`, new Date(value));
			}

		},
		GTE: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.gte`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.gte`, new Date(value));
			}

		},
		NEM: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (fieldInfo.type === 'Int' && !fieldInfo.isRequired) {
				_.set(prismaFilters, `${propertyName}.not`, null);
			}
			if (fieldInfo.type === 'String' && !fieldInfo.isRequired) {
				_.set(prismaFilters, `${propertyName}.not`, null);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.not`, null);
			}
		},
		RG: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isArray(value)) {
				const [startValue, endValue] = value
				if (fieldInfo.type === 'DateTime') {
					const start = new Date(startValue);
					const end = new Date(endValue);
					end.setDate(end.getDate() + 1);
					_.set(prismaFilters, `${propertyName}.gte`, start);
					_.set(prismaFilters, `${propertyName}.lt`, end);
					return;
				}
				_.set(prismaFilters, `${propertyName}.lte`, endValue);
				_.set(prismaFilters, `${propertyName}.gte`, startValue);
			}

		},
	}

	protected modeToPrismaFilter(filters: SearchFilterRecord) {
		return _.transform<SearchFilterValue, any>(filters, (finalFilters, filter, fieldName) => {
			const { mode, value, isRelation } = filter;
			if (!_.has(this.modeToTypeMappers, mode)) {
				throw new Error(`Unsupported filter mode: ${mode}`);
			}
			this.modeToTypeMappers[mode](finalFilters, value, fieldName, this.currentModelFieldsMapping[fieldName], isRelation);
		}, {});
	}

	protected filtersToPrismaOrCondition(filters: SearchFilterRecord[]) {
		return _.transform<SearchFilterRecord, any>(filters, (finalFilters, modeFilter) => {
			if (!finalFilters.OR) {
				finalFilters.OR = [];
			}
			const prismaFilter = this.modeToPrismaFilter(modeFilter);
			finalFilters.OR.push(prismaFilter);
		}, {});
	}

	async getAll({ filters, offset, limit, fields, orderBy }: SearchParams) {
		const prismaWhere = this.filtersToPrismaOrCondition(filters)
		const selectFields = _.transform(fields, (result, field) => {
			if (_.includes(field, '.')) {
				const [relations, relationColumnName] = _.split(field, '.')
				if (!result[relations]) {
					result[relations] = { select: {} };
				}
				result[relations].select[relationColumnName] = true;
				return;
			}
			result[field] = true;
		}, {})
		const properties = {
			skip: offset,
			take: limit,
			orderBy: orderBy,
			where: prismaWhere,
			select: selectFields
		};
		const { _count: { id: total } } = await (this.repository as any).aggregate({
			where: prismaWhere,
			_count: {
				id: true,
			}
		});
		const items = await (this.repository as any).findMany(properties);
		return {
			total,
			items
		};
	}
}
