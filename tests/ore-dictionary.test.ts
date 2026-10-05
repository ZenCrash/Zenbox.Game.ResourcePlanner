import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oreDictionaryPeers, type OreDictionary } from '../lib/ore-dictionary';

test('ore peers include direct shared groups, without transitive expansion', () => {
  const dictionary: OreDictionary = { logs: [['a:log', 0], ['b:log', 0]], wood: [['b:log', 0], ['c:plank', 0]] };
  const peers = oreDictionaryPeers(dictionary, { registryId: 'a:log', metadata: 0, kind: 'item' });
  assert.deepEqual(peers.groups, ['logs']);
  assert(peers.matches({ registryId: 'b:log', metadata: 0, kind: 'item' }));
  assert(!peers.matches({ registryId: 'c:plank', metadata: 0, kind: 'item' }));
  assert(!peers.matches({ registryId: 'b:log', metadata: 1, kind: 'item' }));
});

test('wildcards match subtypes but never fluids', () => {
  const peers = oreDictionaryPeers({ logs: [['a:log', 32767], ['b:log', 2]] }, { registryId: 'a:log', metadata: 4, kind: 'item' });
  assert(peers.matches({ registryId: 'a:log', metadata: 7, kind: 'item' }));
  assert(!peers.matches({ registryId: 'a:log', metadata: 7, kind: 'fluid' }));
  assert.deepEqual(oreDictionaryPeers({ logs: [['a:log', 32767]] }, { registryId: 'a:log', metadata: 4, kind: 'fluid' }).groups, []);
});
