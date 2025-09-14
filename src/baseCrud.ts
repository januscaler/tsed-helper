import { useDecorators } from '@tsed/core';
import { Delete, Get, inject, Post, Put, } from '@tsed/common';
import { Any, CollectionOf, Default, Example, Property, Returns, Summary } from '@tsed/schema';
import _ from 'lodash';
import { SearchFilterRecord } from './types.js';

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
	@Default(['name', 'roles.name']) @CollectionOf(String) fields?: string[];
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
