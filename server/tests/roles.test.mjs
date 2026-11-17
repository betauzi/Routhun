import test from 'node:test';
import assert from 'node:assert/strict';
import { visiblePages, canVisit } from '../../src/roles.js';

test('role navigation hides irrelevant pages and blocks direct navigation', () => {
 assert.deepEqual(visiblePages(null),['track','public','architecture']);
 assert.deepEqual(visiblePages('board'),['overview','expenses','reports','audit','public']);
 assert.deepEqual(visiblePages('auditor'),['overview','ledger','expenses','proof','reports','audit','public']);
 assert.equal(canVisit('staff','team'),false);
 assert.equal(canVisit('staff','allocations'),true);
 assert.equal(canVisit('admin','team'),true);
 assert.equal(canVisit(null,'bank'),false);
});
