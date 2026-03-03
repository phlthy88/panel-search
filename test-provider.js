#!/usr/bin/env gjs

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FileScanner } from './fileScanner.js';
import { fuzzyScore } from './fuzzyMatch.js';
import { FileSearchProvider } from './fileProvider.js';

// Simple test runner
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
        console.log(`\nTests: ${this.passed} passed, ${this.failed} failed`);
    }
}

const runner = new TestRunner();

runner.add('FileSearchProvider should return ranked suggestions with icons', async () => {
    const tmpBase = `/tmp/panel-search-provider-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);
    const file = tmpDir.get_child('provider-test-file.txt');
    file.replace_contents('test content', null, false, Gio.FileCreateFlags.NONE, null);

    try {
        const provider = new FileSearchProvider({});
        provider._scanner = new FileScanner(tmpBase);
        
        const suggestions = await provider.getSuggestions('provider');

        if (suggestions.length === 0) {
            throw new Error('Expected at least one suggestion for query "provider"');
        }

        const s = suggestions[0];
        if (s.label !== 'provider-test-file.txt') {
            throw new Error(`Expected "provider-test-file.txt", got "${s.label}"`);
        }

        if (!s.icon) {
            throw new Error('Expected icon to be present in suggestion');
        }
        
        if (!s.subtitle || !s.subtitle.includes(tmpBase)) {
            throw new Error('Expected subtitle to contain the file path');
        }
    } finally {
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

await runner.run();
