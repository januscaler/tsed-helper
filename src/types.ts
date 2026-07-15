export type FilterMode = 'EQ' | 'EX' | 'LT' | 'LTE' | 'GT' | 'GTE' | 'EM' | 'NEM' | 'RG';

export interface SearchFilterValue {
	mode: FilterMode;
	/** For EQ/EX: scalar or array. For LT/LTE/GT/GTE: number or ISO date string. For RG: [start, end]. For EM/NEM: ignored. */
	value: any;
	isRelation?: boolean;
}
export type SearchFilterRecord = Record<string, SearchFilterValue>
