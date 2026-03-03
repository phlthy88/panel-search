#!/usr/bin/env gjs

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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
                console.error(e.stack);
                this.failed++;
            }
        }
        console.log(`
Tests: ${this.passed} passed, ${this.failed} failed`);
        if (this.failed > 0) {
            System.exit(1);
        }
    }
}

import { FileScanner } from './fileScanner.js';

const runner = new TestRunner();

runner.add('FileScanner should find files in a directory', async () => {
    // Setup: Create a temp directory with some files
    const tmpBase = `/tmp/panel-search-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);

    const file1 = tmpDir.get_child('test1.txt');
    file1.replace_contents('content1', null, false, Gio.FileCreateFlags.NONE, null);

    const file2 = tmpDir.get_child('other.log');
    file2.replace_contents('content2', null, false, Gio.FileCreateFlags.NONE, null);

    const subDir = tmpDir.get_child('subdir');
    subDir.make_directory(null);
    const file3 = subDir.get_child('hidden.txt');
    file3.replace_contents('content3', null, false, Gio.FileCreateFlags.NONE, null);

    try {
        const scanner = new FileScanner(tmpBase);
        const results = await scanner.scan('test');

        // This is expected to FAIL in the RED phase because scan() returns []
        if (results.length === 0) {
            throw new Error('Expected to find at least one file matching "test"');
        }

        const hasTest1 = results.some(r => r.name === 'test1.txt');
        if (!hasTest1) {
            throw new Error('Expected results to contain "test1.txt"');
        }
    } finally {
        // Cleanup
        // Recursive delete is tricky with Gio, so we just leave it in /tmp for now or use rm -rf
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

await runner.run();
console.log('All tests finished.');
