import _ from 'lodash';
import aigle from 'aigle'
import { sync } from 'glob'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { Aigle } = aigle

export class SeederHelper {

    async getAllSeeds(seedGlobPatten = './src/controllers/rest/**/seed.ts') {
        const allSeedsPaths = sync(join(__dirname, '../../../../', seedGlobPatten), { dotRelative: true })
        return await Aigle.transform<any, any>(allSeedsPaths, async (entities, seedPath) => {
            const entityName = basename(dirname(seedPath))
            const { default: seedMap } = await import(seedPath)
            entities[entityName] = {
                entityName,
                ...seedMap
            };
        }, {})
    }

    async generatePrismaCreateUpdatePayload({ rowData, metaMapper, entity, prismaService }) {
        const entityFieldMapping = await metaMapper.getEntityFieldMapping(entity);
        return Aigle.transform(rowData, async (createPayload, value, column: string) => {
            if (entityFieldMapping[column]?.relationName) {
                const targetColumnEntityName = _.lowerFirst(entityFieldMapping[column].type)
                const prismaEntityClient = prismaService[targetColumnEntityName]
                if (_.isObjectLike(value)) {
                    const idsToConnect = await prismaEntityClient.findMany({
                        where: value,
                        select: { id: true }
                    })
                    createPayload[column] = {
                        connect: idsToConnect
                    }
                }
                if (value === '*') {
                    const allItems = await prismaEntityClient.findMany({ select: { id: true } })
                    createPayload[column] = {
                        connect: allItems
                    }
                }

            }
            else {
                createPayload[column] = value
            }
        }, {})
    }

    sortEntitiesByDependency(entities, selectedEntitiesToSeed) {
        const dependencyMap = new Map();

        selectedEntitiesToSeed.forEach(entityName => {
            const { dependsOn } = entities[entityName] ?? {};
            dependencyMap.set(entityName, dependsOn || []);
        });

        const sortedEntities: any[] = [];
        const visited = new Set();
        const visiting = new Set();

        function visit(entity) {
            if (visited.has(entity)) return; // already sorted
            if (visiting.has(entity)) throw new Error("Cyclic dependency detected"); // handle cyclic dependencies

            visiting.add(entity);

            const dependencies = dependencyMap.get(entity) || [];
            dependencies.forEach(dep => {
                if (selectedEntitiesToSeed.includes(dep)) {
                    visit(dep);
                }
            });

            visiting.delete(entity);
            visited.add(entity);
            sortedEntities.push(entity);
        }
        selectedEntitiesToSeed.forEach(entity => {
            if (!visited.has(entity)) {
                visit(entity);
            }
        });

        return sortedEntities;
    }


}