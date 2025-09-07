import { OnInit } from '@tsed/di';
import _ from 'lodash';
import { SearchParams } from './baseCrud.js';
import { Subject } from 'rxjs';
import { PrismaMapperEntity, PrismaMapperEntityField, PrismaMetaMapper } from './prismaMetaMapper.js'
import { Generics } from '@tsed/schema';

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

	protected modeToTypeMappers = {
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
				_.set(prismaFilters, `${propertyName}.equals`, value);
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

	protected modeToFilter(filters?: Record<string, { mode: string; value: any, isRelation?: boolean }>) {
		return _.transform(
			filters ?? {},
			(finalFilters: any, filter, fieldName) => {
				const { mode, value, isRelation } = filter;
				this.modeToTypeMappers[mode](finalFilters, value, fieldName, this.currentModelFieldsMapping[fieldName], isRelation);
			},
			{}
		);
	}

	async getAll({ filters, offset, limit, fields, include, orderBy }: SearchParams) {
		const properties = {
			skip: offset,
			take: limit,
			include: {
				...include,
				..._.transform(_.remove(fields, 'id'), (result, field) => {
					result[field] = true;
				}, {})
			},
			orderBy: orderBy,
			where: this.modeToFilter(filters),
			select: _.isNil(fields)
				? null
				: _.transform(fields, (result, field) => {
					result[field] = true;
				}, {})
		};
		if (_.size(properties.include)) {
			delete properties.select;
		}

		const { _count: { id: total } } = await this.injectedRepository.aggregate({
			where: this.modeToFilter(filters),
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
