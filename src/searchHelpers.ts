import _ from 'lodash';
import type { SearchFilterRecord } from './types.js';

export interface ComputedFieldDefinition<T = any> {
	name: string;
	needs: string[];
	compute: (item: T) => any | Promise<any>;
	type: 'boolean' | 'number' | 'string';
	filterable?: boolean;
	sortable?: boolean;
	/** True when Prisma $extends already computes this field at query time. When set, the field is NOT stripped from Prisma select (Prisma needs it explicitly) and NOT re-attached post-query (Prisma already pushed it). Filter/sort still work in-memory. */
	prismaComputed?: boolean;
}

export interface ComputedFilterEntry {
	fieldName: string;
	mode: string;
	value: any;
}

export interface SplitResult {
	prismaFilters: SearchFilterRecord[];
	computedFilters: ComputedFilterEntry[];
	prismaFields: string[];
	prismaOrderBy: Record<string, 'asc' | 'desc'>;
	computedOrderBy: Record<string, 'asc' | 'desc'>;
	activeComputedDefs: ComputedFieldDefinition[];
}

export function splitSearchParams(
	params: {
		filters?: SearchFilterRecord[];
		fields?: string[];
		orderBy?: Record<string, 'asc' | 'desc'>;
	},
	computedDefs: ComputedFieldDefinition[],
): SplitResult {
	const computedNames = new Set(computedDefs.map((d) => d.name));
	const defByName = new Map(computedDefs.map((d) => [d.name, d]));
	const requestedFields = params.fields ?? [];

	const computedFilters: ComputedFilterEntry[] = [];
	const prismaFilters: SearchFilterRecord[] = [];

	for (const orGroup of params.filters ?? []) {
		const prismaGroup: SearchFilterRecord = {};
		for (const [key, cond] of Object.entries(orGroup)) {
			if (computedNames.has(key)) {
				const def = defByName.get(key)!;
				if (def.filterable !== false) {
					computedFilters.push({ fieldName: key, mode: cond.mode, value: cond.value });
				}
			} else {
				prismaGroup[key] = cond;
			}
		}
		if (Object.keys(prismaGroup).length > 0) prismaFilters.push(prismaGroup);
	}

	const activeComputedDefs = collectActiveDefs(computedDefs, requestedFields, computedFilters, params.orderBy ?? {});
	const prismaFields = stripComputedAndInjectNeeds(requestedFields, computedNames, computedDefs, activeComputedDefs);

	const { prisma: prismaOrderBy, computed: computedOrderBy } = partitionOrderBy(params.orderBy ?? {}, computedNames, defByName);

	return { prismaFilters, computedFilters, prismaFields, prismaOrderBy, computedOrderBy, activeComputedDefs };
}

function collectActiveDefs(
	defs: ComputedFieldDefinition[],
	requestedFields: string[],
	computedFilters: ComputedFilterEntry[],
	orderBy: Record<string, string>,
): ComputedFieldDefinition[] {
	const filterNames = new Set(computedFilters.map((f) => f.fieldName));
	const orderNames = new Set(Object.keys(orderBy));
	return defs.filter((d) =>
		requestedFields.some((f) => f === d.name || f.startsWith(d.name + '.'))
		|| filterNames.has(d.name)
		|| orderNames.has(d.name),
	);
}

function stripComputedAndInjectNeeds(
	fields: string[],
	computedNames: Set<string>,
	computedDefs: ComputedFieldDefinition[],
	activeDefs: ComputedFieldDefinition[],
): string[] {
	const prismaComputedNames = new Set(computedDefs.filter((d) => d.prismaComputed).map((d) => d.name));
	const prismaFields = fields.filter((f) => {
		const root = f.split('.')[0];
		if (!computedNames.has(root)) return true;
		return prismaComputedNames.has(root); // keep if Prisma handles it
	});
	for (const def of activeDefs) {
		for (const need of def.needs) {
			if (!prismaFields.includes(need)) prismaFields.push(need);
		}
	}
	return prismaFields;
}

function partitionOrderBy(
	orderBy: Record<string, 'asc' | 'desc'>,
	computedNames: Set<string>,
	defByName: Map<string, ComputedFieldDefinition>,
): { prisma: Record<string, 'asc' | 'desc'>; computed: Record<string, 'asc' | 'desc'> } {
	const prisma: Record<string, 'asc' | 'desc'> = {};
	const computed: Record<string, 'asc' | 'desc'> = {};
	for (const [key, value] of Object.entries(orderBy)) {
		if (computedNames.has(key) && defByName.get(key)?.sortable !== false) {
			computed[key] = value;
		} else if (!computedNames.has(key)) {
			prisma[key] = value;
		}
	}
	return { prisma, computed };
}

export function buildSelect(fields: string[]): Record<string, unknown> | undefined {
	if (!fields.length) return undefined;
	return _.transform(fields, (result: Record<string, any>, field) => {
		if (field.includes('.')) {
			const [relation, col] = field.split('.');
			if (!result[relation]) result[relation] = { select: {} };
			result[relation].select[col] = true;
			return;
		}
		result[field] = true;
	}, {});
}

export function buildOrderBy(orderBy: Record<string, 'asc' | 'desc'>): Array<Record<string, string>> {
	return _.map(orderBy, (value, key) => ({ [key]: value }));
}

export function applyComputedFilters<T>(
	items: T[],
	computedFilters: ComputedFilterEntry[],
	defByName: Map<string, ComputedFieldDefinition>,
): T[] {
	if (!computedFilters.length) return items;
	return items.filter((item) =>
		computedFilters.every((cf) => {
			const def = defByName.get(cf.fieldName);
			if (!def) return true;
			return matchesComputedFilter(def.compute(item), cf.mode, cf.value, def.type);
		}),
	);
}

export function applyComputedSort<T>(
	items: T[],
	computedOrderBy: Record<string, 'asc' | 'desc'>,
	defByName: Map<string, ComputedFieldDefinition>,
): T[] {
	const entries = Object.entries(computedOrderBy);
	if (!entries.length) return items;
	const sorted = [...items];
	for (const [fieldName, direction] of entries) {
		const def = defByName.get(fieldName);
		if (!def) continue;
		sorted.sort((a, b) => compareComputedValues(def.compute(a), def.compute(b), direction));
	}
	return sorted;
}

export function paginate<T>(items: T[], offset: number, limit: number): T[] {
	return items.slice(offset, offset + limit);
}

export function matchesComputedFilter(
	val: any,
	mode: string,
	target: any,
	type: 'boolean' | 'number' | 'string',
): boolean {
	if (val == null) return false;
	const coercedTarget = type === 'number' ? Number(target)
		: type === 'boolean' ? (target === true || target === 'true')
		: String(target);

	switch (mode) {
		case 'EQ': return type === 'string'
			? String(val).toLowerCase().includes(String(target).toLowerCase())
			: val === coercedTarget;
		case 'EX': return type === 'string'
			? !String(val).toLowerCase().includes(String(target).toLowerCase())
			: val !== coercedTarget;
		case 'EM': return val == null;
		case 'NEM': return val != null;
		case 'LT': return Number(val) < Number(target);
		case 'LTE': return Number(val) <= Number(target);
		case 'GT': return Number(val) > Number(target);
		case 'GTE': return Number(val) >= Number(target);
		case 'RG': return Number(val) >= Number(target?.[0]) && Number(val) <= Number(target?.[1]);
		default: return true;
	}
}

export function compareComputedValues(a: any, b: any, direction: 'asc' | 'desc'): number {
	if (a == null && b == null) return 0;
	if (a == null) return direction === 'asc' ? 1 : -1;
	if (b == null) return direction === 'asc' ? -1 : 1;
	if (typeof a === 'number' && typeof b === 'number') return direction === 'asc' ? a - b : b - a;
	const cmp = String(a).localeCompare(String(b));
	return direction === 'asc' ? cmp : -cmp;
}

export async function attachComputedFields<T extends Record<string, any>>(
	items: T[],
	activeDefs: ComputedFieldDefinition[],
	requestedFields: string[],
): Promise<T[]> {
	if (!items.length || !activeDefs.length) return items;

	const defsToAttach = activeDefs.filter((def) => {
		if (def.prismaComputed) return false; // Prisma already pushed this field
		if (!requestedFields.length) return true;
		return requestedFields.some((f) => f === def.name || f.startsWith(def.name + '.'));
	});
	if (!defsToAttach.length) return items;

	const enriched = [...items];
	for (const def of defsToAttach) {
		try {
			const values = await Promise.all(enriched.map((item) => Promise.resolve(def.compute(item))));
			values.forEach((val, i) => { enriched[i] = { ...enriched[i], [def.name]: val }; });
		} catch (err) {
			console.error(`searchHelpers :: computed field "${def.name}" failed`, err);
			enriched.forEach((_, i) => { enriched[i] = { ...enriched[i], [def.name]: null }; });
		}
	}
	return enriched;
}
