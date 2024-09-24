import { InjectorService, OnInit, Service } from '@tsed/di';
import _ from 'lodash';
import { SearchParams } from './baseCrud';

import { Subject } from 'rxjs';

export interface IBaseService {
	onUpdate: Subject<{ id: number, inputData: any, result: any }>
	onDelete: Subject<{ id: number, result: any }>
	onCreate: Subject<{ data: any, result: any }>
}

@Service()
export class BaseService<T> implements OnInit, IBaseService {
	constructor(public token: string, public injectService: InjectorService, private prismaService: any) { }

	private repositoryContainer: any;

	onUpdate: Subject<{ id: number, inputData: any, result: any }> = new Subject()

	onCreate: Subject<{ data: any, result: any }> = new Subject()

	onDelete: Subject<{ id: number, result: any }> = new Subject()

	get repository() {
		return this.repositoryContainer as T;
	}

	extend<T>(model: string, computedFields: Record<string, {
		needs: Partial<Record<keyof T, boolean>>
		compute: (model: T) => any
	}>) {
		const data = this.prismaService.$extends({
			result: {
				[_.toLower(model)]: computedFields as any
			}
		})
		this.repositoryContainer = data[_.toLower(model)]
	}


	$onInit(): void | Promise<any> {
		this.repositoryContainer = this.injectService.get<typeof this.token>(this.token);
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

	async update(id: number, data: any) {
		const result = await this.repositoryContainer.update({ where: { id }, data });
		this.onUpdate.next({ id, inputData: data, result });
		return result;
	}

	readonly MODES = {
		EQ: 'EQ',
		EQEM: 'EQEM',
		EXEM: 'EXEM',
		NEM: 'NEM',
		EM: 'EM',
		LT: 'LT',
		GT: 'GT',
		EX: 'EX'
	};

	readonly modesToFilterMap = {
		contains: '',
		equals: '',
		endsWith: '',
		gt: '',
		gte: '',
		in: [''],
		lt: '',
		lte: '',
		not: '',
		notIn: [],
		startsWith: ''
	};

	modeToFilter(filters?: Record<string, { mode: string; value: any, isRelation?: boolean }>) {
		return _.transform(
			filters ?? {},
			(finalFilters, filter, propertyName) => {
				const { mode, value, isRelation } = filter;
				if (_.isNumber(value)) {
					switch (mode) {
						case this.MODES.EM:
							_.set(finalFilters, `${propertyName}`, null);
							break;
						case this.MODES.NEM:
							_.set(finalFilters, `${propertyName}.not.equals`, null);
							break;
						case this.MODES.LT:
							_.set(finalFilters, `${propertyName}.lt`, value);
							break;
						case this.MODES.GT:
							_.set(finalFilters, `${propertyName}.gt`, value);
							break;
						case this.MODES.EQ:
							_.set(finalFilters, `${propertyName}.equals`, value);
							break;
						case this.MODES.EXEM:
							_.set(finalFilters, `${propertyName}.not.equals`, value);
							break;
						case this.MODES.EX:
							_.set(finalFilters, `${propertyName}.not.equals`, value);
							break;
					}
				}
				if (_.isArray(value)) {
					switch (mode) {
						case this.MODES.EM:
							_.set(finalFilters, `${propertyName}.none`, {});
							break;
						case this.MODES.NEM:
							_.set(finalFilters, `${propertyName}.some`, {});
							break;
						case this.MODES.EQ:
							if (isRelation) {
								_.set(finalFilters, `${propertyName}.some.id.in`, value);
							} else {
								_.set(finalFilters, `${propertyName}.in`, value);
							}
							break;
						case this.MODES.EX:
							if (isRelation) {
								_.set(finalFilters, `${propertyName}.none.id.in`, value);
							} else {
								_.set(finalFilters, `${propertyName}.not.in`, value);
							}
							break;
					}
				}
				if (_.isString(value)) {
					switch (mode) {
						case this.MODES.EM:
							_.set(finalFilters, `${propertyName}.equals`, null);
							break;
						case this.MODES.NEM:
							_.set(finalFilters, `${propertyName}.not.equals`, null);
							break;
						case this.MODES.EQ:
							_.set(finalFilters, `${propertyName}.contains`, value);
							break;
						case this.MODES.EQEM:
							_.set(finalFilters, `${propertyName}.equals`, value);
							break;
						case this.MODES.EXEM:
							_.set(finalFilters, `${propertyName}.not.equals`, value);
							break;
						case this.MODES.EX:
							_.set(finalFilters, `${propertyName}.not.contains`, value);
							break;
					}
				}
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
		const total = await this.repositoryContainer?.collection?.count() || this.repositoryContainer?.count();
		const items = await this.repositoryContainer.findMany(properties);
		return {
			total,
			items
		};
	}
}
