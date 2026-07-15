import _ from 'lodash';

export function buildPayloadWithRelations(
	data: Record<string, any>,
	fieldNames: string[],
	relationOperation: string,
	relationValueMapper?: (fieldName: string, value: any) => any,
): Record<string, any> {
	const defaultMapper = (value: any) => (_.isArray(value) ? _.map(value, (id: any) => ({ id })) : { id: value });

	const scalars = _.pick(data, fieldNames);
	const relations = _.omit(data, fieldNames);

	const relationPayload = _.transform(relations, (result: Record<string, any>, value: any, key: string) => {
		if (_.isNil(value)) return;
		const mapped = relationValueMapper ? relationValueMapper(key, value) : defaultMapper(value);
		if (_.isNil(mapped)) return;
		result[key] = { [relationOperation]: mapped };
	}, {});

	return { ...scalars, ...relationPayload };
}
