#!/usr/bin/env gjs

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FileScanner } from './fileScanner.js';
import { fuzzyScore } from './fuzzyMatch.js';

// Simple test runner (copied and simplified)
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
                this.failed++;
            }
        }
        console.log(`
Tests: ${this.passed} passed, ${this.failed} failed`);
    }
}

import { FileSearchProvider } from './fileProvider.js';

const runner = new TestRunner();

runner.add('FileSearchProvider should return ranked suggestions', async () => {
    const tmpBase = `/tmp/panel-search-provider-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);
    const file = tmpDir.get_child('provider-test-file.txt');
    file.replace_contents('test content', null, false, Gio.FileCreateFlags.NONE, null);

    try {
        // Mock provider to scan the temp directory instead of home
        const provider = new FileSearchProvider({});
        provider._scanner = new FileScanner(tmpBase);
        
        const suggestions = await provider.getSuggestions('provider');

        if (suggestions.length === 0) {
            throw new Error('Expected at least one suggestion for query "provider"');
        }

        if (suggestions[0].label !== 'provider-test-file.txt') {
            throw new Error(`Expected "provider-test-file.txt", got "${suggestions[0].label}"`);
        }
    } finally {
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

await runner.run();
