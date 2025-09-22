import { OnInit } from '@tsed/di';
import _ from 'lodash';
import { SearchParams } from './baseCrud.js';
import { Subject } from 'rxjs';
import { PrismaMapperEntity, PrismaMapperEntityField, PrismaMetaMapper } from './prismaMetaMapper.js'
import { Generics } from '@tsed/schema';
import { SearchFilterRecord, SearchFilterValue } from './types.js';

export interface IBaseService {
	onUpdate: Subject<{ id: number, inputData: any, result: any }>
	onDelete: Subject<{ id: number, result: any }>
	onCreate: Subject<{ data: any, result: any }>
}
@Generics("T")
export class BaseService<T> implements OnInit, IBaseService {
	/**
 * Service configuration options.
 *
 * @property {Prisma.Repository} injectedRepository - A valid Prisma model repository required for this service.
 * @property {PrismaService} prismaService - An instance of the PrismaService.
 * @property {string} [relativePrismaFilePath="./prisma/schema.prisma"] - Optional path to the Prisma schema file. Defaults to "./prisma/schema.prisma".
 */
	constructor(public injectedRepository: any, private prismaService: any, relativePrismaFilePath?: string) {
		this.prismaFilePath = relativePrismaFilePath ?? "./prisma/schema.prisma"
	}
	public prismaFilePath: string
	tablesInfo: Record<string, PrismaMapperEntity> = {}

	onUpdate: Subject<{ id: number, inputData: any, result: any }> = new Subject()

	onCreate: Subject<{ data: any, result: any }> = new Subject()

	onDelete: Subject<{ id: number, result: any }> = new Subject()

	get repository() {
		return this.injectedRepository as T;
	}

	get fieldNames() {
		if (this.injectedRepository?.collection) {
			return Object.keys(this.injectedRepository.collection.fields)
		}
		else if (this.injectedRepository?.fields) {
			return Object.keys(this.injectedRepository.fields)
		}
		throw new Error('injectedRepository has no fields, probably you passed wrong repository');
	}

	get currentModelName() {
		if (this.injectedRepository?.name) {
			return this.injectedRepository.name
		}
		if (this.injectedRepository?.collection?.name) {
			return this.injectedRepository.collection.name;
		}
	}

	get currentModelInfo() {
		return this.tablesInfo[this.currentModelName]
	}

	get currentModelFieldsMapping() {
		const { fields } = this.currentModelInfo
		return _.transform(fields, (result, field) => {
			result[field.name] = field;
		}, {}) as Record<string, PrismaMapperEntityField>
	}

	extend<T>(model: string, computedFields: Record<string, {
		needs: Partial<Record<keyof T, boolean>>
		compute: (model: T) => any
	}>) {
		const data = this.prismaService.$extends({
			result: {
				[_.camelCase(model)]: computedFields as any
			}
		})
		this.injectedRepository = data[_.camelCase(model)]
	}


	async $onInit(): Promise<any> {
		const prismaMapper = new PrismaMetaMapper(this.prismaFilePath)
		this.tablesInfo = await prismaMapper.getTablesInfo()
	}

	async create(data: any) {
		const result = await this.injectedRepository.create({ data });
		this.onCreate.next({ data, result });
		return result;
	}

	async deleteItem(id: number) {
		const result = await this.injectedRepository.delete({ where: { id }, select: { id: true } });
		this.onDelete.next({ id, result });
		return result;
	}

	async getOne(id: number) {
		return (await this.injectedRepository.findFirst({ where: { id } })) || {};
	}

	async update(id: number, data: any, { relationOperation, relationvalueMapper }: {
		relationOperation?: 'set' | 'disconnect' | 'delete' | 'connect' | 'disconnectMany' | 'deleteMany' | 'create' | 'createMany' | 'update' | 'updateMany' | 'upsert' | 'upsertMany'
		relationvalueMapper?: (value: any) => any
	} = {}) {
		const defaultRelationValueMapper = (value: any) => (_.isArray(value) ? _.map(value, (id: any) => ({ id })) : { id: value })
		const dataWithRelations = _.pick(data, this.fieldNames)
		const relationData = _.omit(data, this.fieldNames)
		const finalData = _.transform(relationData, (result, value, key) => {
			if (_.isNil(value)) {
				return
			}
			result[key] = { [relationOperation ?? 'set']: relationvalueMapper ? relationvalueMapper(value) : defaultRelationValueMapper(value) }
		}, {
			...dataWithRelations
		})
		const result = await this.injectedRepository.update({ where: { id }, data: finalData });
		this.onUpdate.next({ id, inputData: data, result });
		return result;
	}

	readonly MODES = {
		EQ: 'EQ',
		EX: 'EX',
		LT: 'LT',
		GT: 'GT',
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
				_.set(prismaFilters, `${propertyName}.lt`, value);
			}
		},
		GT: (prismaFilters: any, value: any, propertyName: string, fieldInfo: any, isRelation: boolean) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.gt`, value);
			}
			if (fieldInfo.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.gt`, value);
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
		const { _count: { id: total } } = await this.injectedRepository.aggregate({
			where: prismaWhere,
			_count: {
				id: true,
			}
		});
		const items = await this.injectedRepository.findMany(properties);
		return {
			total,
			items
		};
	}
}
