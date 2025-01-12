import { InjectorService, OnInit } from '@tsed/di';
import _ from 'lodash';
import { SearchParams } from './baseCrud';
import { Subject } from 'rxjs';
import { PrismaMapperEntity, PrismaMapperEntityField, PrismaMetaMapper } from './prismaMetaMapper'

export interface IBaseService {
	onUpdate: Subject<{ id: number, inputData: any, result: any }>
	onDelete: Subject<{ id: number, result: any }>
	onCreate: Subject<{ data: any, result: any }>
}

export class BaseService<T> implements OnInit, IBaseService {
	constructor(public token: string, public injectService: InjectorService, private prismaService: any, relativePrismaFilePath?: string) {
		this.prismaFilePath = relativePrismaFilePath ?? "./prisma/schema.prisma"
	}
	public prismaFilePath: string
	private repositoryContainer: any;
	tablesInfo: Record<string, PrismaMapperEntity> = {}

	onUpdate: Subject<{ id: number, inputData: any, result: any }> = new Subject()

	onCreate: Subject<{ data: any, result: any }> = new Subject()

	onDelete: Subject<{ id: number, result: any }> = new Subject()

	get repository() {
		return this.repositoryContainer as T;
	}

	get fieldNames() {
		if (this.repositoryContainer?.collection) {
			return Object.keys(this.repositoryContainer.collection.fields)
		}
		else if (this.repositoryContainer?.fields) {
			return Object.keys(this.repositoryContainer.fields)
		}
		throw new Error('repositoryContainer has no fields, probably you passed wrong repository');
	}

	get currentModelName() {
		if (this.repositoryContainer?.name) {
			return this.repositoryContainer.name
		}
		if (this.repositoryContainer?.collection?.name) {
			return this.repositoryContainer.collection.name;
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
		this.repositoryContainer = data[_.camelCase(model)]
	}


	async $onInit(): Promise<any> {
		const prismaMapper = new PrismaMetaMapper(this.prismaFilePath)
		this.repositoryContainer = this.injectService.get<typeof this.token>(this.token);
		this.tablesInfo = await prismaMapper.getTablesInfo()
	}

	async create(data: any) {
		const result = await this.repositoryContainer.create({ data });
		this.onCreate.next({ data, result });
		return result;
	}

	async deleteItem(id: number) {
		const result = await this.repositoryContainer.delete({ where: { id }, select: { id: true } });
		this.onDelete.next({ id, result });
		return result;
	}

	async getOne(id: number) {
		return (await this.repositoryContainer.findFirst({ where: { id } })) || {};
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
		const result = await this.repositoryContainer.update({ where: { id }, data: finalData });
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
		EM: ({prismaFilters, value, fieldName, fieldInfo, isRelation,nestedFieldPath}) => {
			if ((fieldInfo?.type === 'Int' || fieldInfo?.type === 'String' || nestedFieldPath) && !fieldInfo?.isRequired) {
				_.set(prismaFilters, `${nestedFieldPath?nestedFieldPath:fieldName}`, null);
			}
		},
		EQ: ({ prismaFilters, value, propertyName, fieldInfo, isRelation, nestedFieldPath }) => {
			if (fieldInfo?.type === 'Int') {
				_.set(prismaFilters, `${propertyName}.equals`, value);
			}
			if (fieldInfo?.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.equals`, value);
			}
			if (_.isArray(value)) {
				if (isRelation) {
					_.set(prismaFilters, `${propertyName}.some.id.in`, value);
				} else {
					_.set(prismaFilters, `${propertyName}.in`, value);
				}
			}
			if (fieldInfo?.type === 'String' || nestedFieldPath) {
				_.set(prismaFilters, `${nestedFieldPath?nestedFieldPath:propertyName}.contains`, value);
			}
		},
		EX: ({ prismaFilters, value, propertyName, fieldInfo, isRelation, nestedFieldPath }) => {
			if (_.isNumber(value)) {
				_.set(prismaFilters, `${propertyName}.not.equals`, value);
			}
			if (fieldInfo?.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.not.equals`, value);
			}
			if (_.isArray(value)) {
				if (isRelation) {
					_.set(prismaFilters, `${propertyName}.none.id.in`, value);
				} else {
					_.set(prismaFilters, `${propertyName}.not.in`, value);
				}
			}
			if (_.isString(value) || nestedFieldPath) {
				_.set(prismaFilters, `${nestedFieldPath?nestedFieldPath:propertyName}.not.contains`, value);
			}
		},
		LT: ({ prismaFilters, value, propertyName, fieldInfo, isRelation, nestedFieldPath }) => {
			if (_.isNumber(value) || fieldInfo?.type === 'DateTime' || nestedFieldPath) {
				_.set(prismaFilters, `${propertyName}.lt`, value);
			}
		},
		GT: ({ prismaFilters, value, propertyName, fieldInfo, isRelation, nestedFieldPath }) => {
			if (_.isNumber(value) || fieldInfo?.type === 'DateTime' || nestedFieldPath) {
				_.set(prismaFilters, `${propertyName}.gt`, value);
			}
		},
		NEM: ({ prismaFilters, value, propertyName, fieldInfo, isRelation, nestedFieldPath }) => {
			if ((fieldInfo?.type === 'Int' || fieldInfo?.type === 'String' || nestedFieldPath) && !fieldInfo?.isRequired) {
				_.set(prismaFilters, `${nestedFieldPath?nestedFieldPath:propertyName}.not`, null);
			}
			if (fieldInfo?.type === 'DateTime') {
				_.set(prismaFilters, `${propertyName}.not`, null);
			}
		},
		RG: ({ prismaFilters, value, propertyName, fieldInfo, isRelation, nestedFieldPath }) => {
			if (_.isArray(value)) {
				const [startValue, endValue] = value
				_.set(prismaFilters, `${nestedFieldPath?nestedFieldPath:propertyName}.lte`, endValue);
				_.set(prismaFilters, `${nestedFieldPath?nestedFieldPath:propertyName}.gte`, startValue);
			}
		},
	}

	protected modeToFilter(filters?: Record<string, { mode: string; value: any, isRelation?: boolean,nestedFieldPath?:string }>) {
		return _.transform(
			filters ?? {},
			(finalFilters: any, filter, fieldName) => {
				const { mode, value, isRelation,nestedFieldPath } = filter;
				this.modeToTypeMappers[mode]({ prismaFilters: finalFilters, value, propertyName: fieldName, fieldInfo: this.currentModelFieldsMapping[fieldName], isRelation, nestedFieldPath });
			},
			{}
		);
	}

	async getAll({ filters, offset, limit, fields, include, orderBy }: SearchParams) {
		const properties = {
			skip: offset,
			take: limit,
			include: include,
			orderBy: orderBy,
			where: this.modeToFilter(filters),
			select: _.isNil(fields)
				? null
				: _.transform(
					fields,
					(result, field) => {
						result[field] = true;
					},
					{}
				)
		};

		const { _count: { id: total } } = await this.repositoryContainer.aggregate({
			where: this.modeToFilter(filters),
			_count: {
				id: true,
			}
		});
		const items = await this.repositoryContainer.findMany(properties);
		return {
			total,
			items
		};
	}
}
