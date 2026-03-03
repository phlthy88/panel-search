#!/usr/bin/env gjs

import GLib from 'gi://GLib';

// Simple test runner (copied from test-filescanner.js)
class TestRunner {
    constructor() {
        this.passed = 0;
        this.failed = 0;
        this.tests = [];
    }

    add(name, fn) {
        this.tests.push({ name, fn });
    }

    async run() {
        console.log('Running tests...');
        for (const test of this.tests) {
            try {
                await test.fn();
                console.log(`[PASS] ${test.name}`);
                this.passed++;
            } catch (e) {
                console.error(`[FAIL] ${test.name}: ${e.message}`);
                console.error(e.stack);
                this.failed++;
            }
        }
        console.log(`
Tests: ${this.passed} passed, ${this.failed} failed`);
    }
}

import { fuzzyScore } from './fuzzyMatch.js';

const runner = new TestRunner();

runner.add('fuzzyScore should return 100 for exact match', async () => {
    const score = fuzzyScore('test', 'test');
    if (score !== 100) throw new Error(`Expected 100, got ${score}`);
});

runner.add('fuzzyScore should return higher score for start matches', async () => {
    const score1 = fuzzyScore('te', 'test');
    const score2 = fuzzyScore('st', 'test');
    if (score1 <= score2) throw new Error(`Expected score1 (${score1}) > score2 (${score2})`);
});

runner.add('fuzzyScore should prefer contiguous matches over scattered ones', async () => {
    const contiguous = fuzzyScore('abc', 'abc-notes');
    const scattered = fuzzyScore('abc', 'a_long_b_gap_c_file');
    if (contiguous <= scattered) {
        throw new Error(`Expected contiguous (${contiguous}) > scattered (${scattered})`);
    }
});

runner.add('fuzzyScore should favor word boundaries', async () => {
    const boundary = fuzzyScore('cfg', 'config_file');
    const embedded = fuzzyScore('cfg', 'myconfigfile');
    if (boundary <= embedded) {
        throw new Error(`Expected boundary (${boundary}) > embedded (${embedded})`);
    }
});

runner.add('fuzzyScore should return 0 if no match', async () => {
    const score = fuzzyScore('abc', 'test');
    if (score !== 0) throw new Error(`Expected 0, got ${score}`);
});

await runner.run();
