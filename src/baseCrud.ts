import { useDecorators } from '@tsed/core';
import { Delete, Get, Post, Put, } from '@tsed/common';
import { CollectionOf, Default, Enum, Example, Property, Required, Returns, Summary } from '@tsed/schema';
import _ from 'lodash';
import { SearchFilterRecord } from './types.js';
import { PrismaMetaMapper } from './prismaMetaMapper.js';
import aigle from 'aigle';
const { Aigle } = aigle;

function nameWithoutModel(model: any): string {
	return _.replace(model.name, 'Model', '');
}
export interface CreateNewOptions extends Record<string, unknown> {
	path?: string;
	model: any;
	summary?: (options: CreateNewOptions) => string;
}

export function createItem(options: CreateNewOptions): Function {
	const { path, model, summary } = options;
	return useDecorators(
		Post(path ?? '/'),
		Summary(summary ? summary(options) : `Create a new ${nameWithoutModel(model)}`),
		Returns(201, model).Groups('createResponse')
	);
}

export interface DeleteOptions extends Record<string, unknown> {
	path?: string;
	model: any;
	summary?: (options: DeleteOptions) => string;
}

export function deleteItem(options: DeleteOptions): Function {
	const { path, model, summary } = options;
	return useDecorators(
		Delete(path ?? '/:id'),
		Summary(summary ? summary(options) : `Delete a ${nameWithoutModel(model)} by id`),
		Returns(200, model).Groups('delete')
	);
}

export interface UpdateOptions extends Record<string, unknown> {
	path?: string;
	model: any;
	summary?: (options: UpdateOptions) => string;
}

export function updateItem(options: UpdateOptions): Function {
	const { path, model, summary } = options;
	return useDecorators(
		Put(path ?? '/:id'),
		Summary(summary ? summary(options) : `Update a ${nameWithoutModel(model)} by id`),
		Returns(200, model).Groups('update')
	);
}

export interface GetItemOptions extends Record<string, unknown> {
	path?: string;
	model: any;
	summary?: (options: GetItemOptions) => string;
}

export function getItem(options: GetItemOptions): Function {
	const { path, model, summary } = options;
	return useDecorators(
		Get(path ?? '/:id'),
		Summary(summary ? summary(options) : `Get a ${nameWithoutModel(model)} by id`),
		Returns(200, model).Groups('read')
	);
}

export interface GetItems {
	path?: string;
	model: any;
	summary?: (options: GetItems) => string;
}

export class SearchParams {
	@Default(10) limit?: number;
	@Default(0) offset?: number;
	@Default({ id: 'asc' }) @CollectionOf(Object) orderBy?: Record<string, 'asc' | 'desc'>;
	@Example(['name', 'roles.name']) @Required(true) @CollectionOf(String) fields?: string[];
	@Default({ name: { mode: 'EQ', value: 'test', isRelation: false } }) @CollectionOf(Object) filters?: SearchFilterRecord[];
}


export function getItems(options: GetItems): Function {
	const { path, model, summary } = options;
	class GetItemsResponse<T> {
		@CollectionOf(model)
		items: T[];
		@Property()
		total: number;
	}
	return useDecorators(
		Post(path ?? '/search'),
		Summary(summary ? summary(options) : `Get all ${nameWithoutModel(model)}`),
		Returns(200, GetItemsResponse<typeof model>)
			.Groups('read')
			.Description(`Return a list of ${nameWithoutModel(model)}`)
	);
}




export type FilterMode =
	| "EM"
	| "EQ"
	| "EX"
	| "LT"
	| "LTE"
	| "GT"
	| "GTE"
	| "NEM"
	| "RG";

export const FilterModeEnum: FilterMode[] = [
	"EM", "EQ", "EX", "LT", "LTE", "GT", "GTE", "NEM", "RG"
];

// Typed filter record
export type SearchFilter<TFields extends string> = {
	[K in TFields]: {
		mode: FilterMode;
		value: any;
		isRelation?: boolean;
	};
};

export class BaseSearchParams {
	@Default(10)
	limit?: number;

	@Default(0)
	offset?: number;
}

export class FilterItemModel {
	@Enum(FilterModeEnum)
	mode!: FilterMode;
	@Property()
	value!: any;
	@Property()
	isRelation?: boolean;
}

export async function makeSearchParamsForPrismaModel<TField extends string>(model: string) {
	const entityFieldMapping = await PrismaMetaMapper.getEntityFieldMapping(PrismaMetaMapper.normalizeEntityName(model));
	const scalarExamples = _.transform(entityFieldMapping, (result, value, key) => {
		if (!value.isList && !value.relationName) {
			result.push(key as TField);
		}
	}, [] as TField[]);
	const relationExamples = await Aigle.transform(entityFieldMapping, async (result, value, key) => {
		if (value.isList || value.relationName) {
			const relationFieldMapping = await PrismaMetaMapper.getEntityFieldMapping(PrismaMetaMapper.normalizeEntityName(value.type));
			for (const [relationFieldName, relationField] of Object.entries(relationFieldMapping)) {
				if (!relationField.isList && !relationField.relationName) {
					result.push(`${key}.${relationFieldName}` as TField);
				}
			}
		}
	}, [] as TField[]);
	return makeSearchParamsFor<TField>([...scalarExamples, ...relationExamples], entityFieldMapping);
}

function getPrismaExample(fieldInfo: { type: string; isArray?: boolean }) {
	let example: any;

	switch (fieldInfo.type) {
		case "String":
			example = "example";
			break;
		case "Int":
			example = 123;
			break;
		case "BigInt":
			example = 123n;
			break;
		case "Float":
			example = 12.34;
			break;
		case "Decimal":
			example = "12.34"; // Prisma Decimal is a string
			break;
		case "Boolean":
			example = true;
			break;
		case "DateTime":
			example = new Date().toISOString();
			break;
		case "Json":
			example = { key: "value" };
			break;
		case "Bytes":
			example = "AA=="; // base64 string
			break;
		default:
			example = "example";
	}

	if (fieldInfo.isArray) {
		return [example];
	}

	return example;
}

export function makeSearchParamsFor<TField extends string>(examples: TField[], entityFieldMapping?: Record<string, any>) {
	const filterExample = [
		examples.reduce((acc, f) => {
			if (!f.includes('.')) {
				const fieldInfo = entityFieldMapping ? entityFieldMapping[f] : null;
				acc[f] = { mode: "EQ", value: getPrismaExample(fieldInfo) };
			}
			return acc;
		}, {} as Record<TField, any>)
	]
	const orderByExample = examples.reduce((acc, f) => {
		if (!f.includes('.')) {
			acc[f] = "asc";
		}
		return acc;
	}, {} as Record<TField, "asc" | "desc">);
	class DynamicSearchParams extends BaseSearchParams {
		@Example(examples)
		@Required(true)
		@CollectionOf(String)
		fields!: TField[];
		@Example(orderByExample)
		@CollectionOf(Object)
		orderBy: Record<TField, "asc" | "desc">;
		@Property()
		@CollectionOf(Object)
		@Example(filterExample)
		filters: SearchFilter<TField>[];
	}

	return DynamicSearchParams;
}