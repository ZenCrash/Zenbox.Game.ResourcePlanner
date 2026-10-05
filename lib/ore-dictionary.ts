export type OreDictionary = Record<string, [string, number][]>;
type OreItem = { registryId: string; metadata: number; kind: string };

/** Forge ore matching ignores NBT; wildcard metadata accepts every item subtype.
 * Only directly shared groups are included, never a transitive union. */
export function oreDictionaryPeers(dictionary: OreDictionary, selected: OreItem) {
  const matches = (entry: [string, number], item: OreItem) =>
    item.kind === 'item' && entry[0] === item.registryId &&
    (entry[1] === 32767 || entry[1] === item.metadata);
  const groups = Object.entries(dictionary).filter(([, members]) =>
    members.some(entry => matches(entry, selected)));
  const entries = groups.flatMap(([, members]) => members);
  return { groups: groups.map(([name]) => name), matches: (item: OreItem) => entries.some(entry => matches(entry, item)) };
}
