import _ from 'lodash';
import pi from '@prisma/internals';
import { join, dirname } from 'path'
import { DMMF, ReadonlyDeep } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { getDMMF } = pi

export interface PrismaMapperEntity {
    name: string;
    dbName: string | null;
    fields: DMMF.Field[];
    uniqueFields: string[][];
    uniqueIndexes: DMMF.uniqueIndex[];
    documentation?: string;
    primaryKey: DMMF.PrimaryKey | null;
    isGenerated?: boolean;
}
export interface PrismaMapperEntityField {
    kind: DMMF.FieldKind;
    name: string;
    isRequired: boolean;
    isList: boolean;
    isUnique: boolean;
    isId: boolean;
    isReadOnly: boolean;
    isGenerated?: boolean;
    isUpdatedAt?: boolean;
    /**
     * Describes the data type in the same the way it is defined in the Prisma schema:
     * BigInt, Boolean, Bytes, DateTime, Decimal, Float, Int, JSON, String, $ModelName
     */
    type: string;
    dbName?: string | null;
    hasDefaultValue: boolean;
    default?: DMMF.FieldDefault | DMMF.FieldDefaultScalar | DMMF.FieldDefaultScalar[];
    relationFromFields?: string[];
    relationToFields?: string[];
    relationOnDelete?: string;
    relationName?: string;
    documentation?: string;
}

export class PrismaMetaMapper {

    constructor(protected relativePrismaFilePath = "./prisma/schema.prisma") { }

    async getDMMF(): Promise<ReadonlyDeep<{
        datamodel: DMMF.Datamodel;
        schema: DMMF.Schema;
        mappings: DMMF.Mappings;
    }>> {
        const dmmf = await getDMMF({
            datamodel: join(__dirname, '../../../../', this.relativePrismaFilePath)
        })
        return dmmf
    }

    async getEntity(entityName: string) {
        const tablesInfo = await this.getTablesInfo()
        return tablesInfo[entityName]
    }

    async getEntityFieldMapping(entityName: string) {
        const { fields } = await this.getEntity(entityName)
        return _.transform(fields, (result, field) => {
            result[field.name] = field;
        }, {}) as Promise<Record<string, PrismaMapperEntityField>>
    }

    async getTablesInfo() {
        const dmmf = await this.getDMMF()
        return _.transform(dmmf.datamodel.models, (finalInfoMap, value) => {
            finalInfoMap[value.name] = value
        }, {}) as Promise<Record<string, PrismaMapperEntity>>
    }
}