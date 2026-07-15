import _ from 'lodash';
import type { PrismaMapperEntityField } from './prismaMetaMapper.js';

const NUMERIC_TYPES = new Set(['Int', 'BigInt', 'Float', 'Decimal']);

export function isNumericType(type: string): boolean {
	return NUMERIC_TYPES.has(type);
}

function numericDateComparison(op: 'lt' | 'lte' | 'gt' | 'gte') {
	return (out: Record<string, any>, value: any, fieldName: string, fieldInfo: PrismaMapperEntityField) => {
		if (isNumericType(fieldInfo.type)) {
			_.set(out, `${fieldName}.${op}`, Number(value));
		}
		if (fieldInfo.type === 'DateTime') {
			_.set(out, `${fieldName}.${op}`, new Date(value));
		}
	};
}

function eqMapper(out: Record<string, any>, value: any, fieldName: string, fieldInfo: PrismaMapperEntityField, isRelation: boolean) {
	if (_.isArray(value)) {
		_.set(out, isRelation ? `${fieldName}.some.id.in` : `${fieldName}.in`, value);
		return;
	}
	if (isNumericType(fieldInfo.type) || fieldInfo.type === 'Boolean') {
		_.set(out, `${fieldName}.equals`, value);
		return;
	}
	if (fieldInfo.type === 'DateTime') {
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			const start = new Date(value);
			const end = new Date(start);
			end.setDate(start.getDate() + 1);
			_.set(out, `${fieldName}.gte`, start);
			_.set(out, `${fieldName}.lt`, end);
		} else {
			_.set(out, `${fieldName}.equals`, new Date(value));
		}
		return;
	}
	if (fieldInfo.type === 'String') {
		_.set(out, `${fieldName}.contains`, value);
		_.set(out, `${fieldName}.mode`, 'insensitive');
	}
}

function exMapper(out: Record<string, any>, value: any, fieldName: string, fieldInfo: PrismaMapperEntityField, isRelation: boolean) {
	if (_.isArray(value)) {
		_.set(out, isRelation ? `${fieldName}.none.id.in` : `${fieldName}.not.in`, value);
		return;
	}
	if (isNumericType(fieldInfo.type)) {
		_.set(out, `${fieldName}.not.equals`, Number(value));
		return;
	}
	if (fieldInfo.type === 'Boolean') {
		_.set(out, `${fieldName}.not.equals`, value);
		return;
	}
	if (fieldInfo.type === 'DateTime') {
		_.set(out, `${fieldName}.not.equals`, new Date(value));
		return;
	}
	if (fieldInfo.type === 'String') {
		_.set(out, `${fieldName}.not.contains`, value);
	}
}

function emMapper(out: Record<string, any>, _value: any, fieldName: string, _fieldInfo: PrismaMapperEntityField) {
	_.set(out, fieldName, null);
}

function nemMapper(out: Record<string, any>, _value: any, fieldName: string, _fieldInfo: PrismaMapperEntityField) {
	_.set(out, `${fieldName}.not`, null);
}

function rgMapper(out: Record<string, any>, value: any, fieldName: string, fieldInfo: PrismaMapperEntityField) {
	if (!_.isArray(value)) return;
	const [start, end] = value;
	if (fieldInfo.type === 'DateTime') {
		const s = new Date(start);
		const e = new Date(end);
		e.setDate(e.getDate() + 1);
		_.set(out, `${fieldName}.gte`, s);
		_.set(out, `${fieldName}.lt`, e);
		return;
	}
	_.set(out, `${fieldName}.gte`, Number(start));
	_.set(out, `${fieldName}.lte`, Number(end));
}

export const filterMappers: Record<string, (out: Record<string, any>, value: any, fieldName: string, fieldInfo: PrismaMapperEntityField, isRelation: boolean) => void> = {
	EQ: eqMapper,
	EX: exMapper,
	EM: emMapper,
	NEM: nemMapper,
	LT: numericDateComparison('lt'),
	LTE: numericDateComparison('lte'),
	GT: numericDateComparison('gt'),
	GTE: numericDateComparison('gte'),
	RG: rgMapper,
};
