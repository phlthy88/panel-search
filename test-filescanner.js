#!/usr/bin/env gjs

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FileScanner } from './fileScanner.js';

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
        console.log(`\nTests: ${this.passed} passed, ${this.failed} failed`);
    }
}

const runner = new TestRunner();

runner.add('FileScanner should find files and include icons', async () => {
    const tmpBase = `/tmp/panel-search-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);

    const file1 = tmpDir.get_child('test1.txt');
    file1.replace_contents('content1', null, false, Gio.FileCreateFlags.NONE, null);

    try {
        const scanner = new FileScanner(tmpBase);
        const results = await scanner.scan('test');

        if (results.length === 0) {
            throw new Error('Expected to find at least one file matching "test"');
        }

        const r = results[0];
        if (!r.name || !r.path || !r.uri) {
            throw new Error('Result missing basic properties');
        }

        if (!r.icon) {
            throw new Error('Expected icon to be present in result');
        }
    } finally {
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

runner.add('FileScanner should respect depth limit', async () => {
    const tmpBase = `/tmp/panel-search-depth-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);

    // level 0: test0.txt
    const file0 = tmpDir.get_child('test0.txt');
    file0.replace_contents('c0', null, false, Gio.FileCreateFlags.NONE, null);

    // level 1: dir1/test1.txt
    const dir1 = tmpDir.get_child('dir1');
    dir1.make_directory(null);
    const file1 = dir1.get_child('test1.txt');
    file1.replace_contents('c1', null, false, Gio.FileCreateFlags.NONE, null);

    // level 2: dir1/dir2/test2.txt
    const dir2 = dir1.get_child('dir2');
    dir2.make_directory(null);
    const file2 = dir2.get_child('test2.txt');
    file2.replace_contents('c2', null, false, Gio.FileCreateFlags.NONE, null);

    try {
        const scanner = new FileScanner(tmpBase);
        // Scan with maxDepth = 1
        const results = await scanner.scan('test', 10, null, 1);

        const hasTest0 = results.some(r => r.name === 'test0.txt');
        const hasTest1 = results.some(r => r.name === 'test1.txt');
        const hasTest2 = results.some(r => r.name === 'test2.txt');

        if (!hasTest0) throw new Error('Expected to find test0.txt at level 0');
        if (!hasTest1) throw new Error('Expected to find test1.txt at level 1');
        if (hasTest2) throw new Error('Did NOT expect to find test2.txt at level 2 (depth limit 1)');
    } finally {
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

runner.add('FileScanner should respect maxDirs limit', async () => {
    const tmpBase = `/tmp/panel-search-dirs-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);

    // Create 5 directories, each with a file
    for (let i = 0; i < 5; i++) {
        const d = tmpDir.get_child(`dir${i}`);
        d.make_directory(null);
        const f = d.get_child(`test${i}.txt`);
        f.replace_contents(`c${i}`, null, false, Gio.FileCreateFlags.NONE, null);
    }

    try {
        const scanner = new FileScanner(tmpBase);
        // Scan with maxDirs = 2
        // It will scan root (1), then dir0 (2), then dir1 (3 - STOP)
        // Wait, current logic scans root, then dir0, then inside dir0, etc.
        // If I limit to 2, it should only scan root and the first dir it finds.
        const results = await scanner.scan('test', 10, null, 3, 2);

        // We expect results from root (if any) and at most 2 directories.
        // In our setup, root has no matching files. dir0 and dir1 have one each.
        // So we expect 2 results.
        if (results.length > 2) {
            throw new Error(`Expected at most 2 results (from 2 dirs), got ${results.length}`);
        }
    } finally {
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

runner.add('FileScanner should continue scanning sibling branches when one directory fails', async () => {
    const tmpBase = `/tmp/panel-search-branch-failure-test-${Math.floor(Math.random() * 1000000)}`;
    const tmpDir = Gio.File.new_for_path(tmpBase);
    tmpDir.make_directory_with_parents(null);

    const goodDir = tmpDir.get_child('good');
    goodDir.make_directory(null);
    const goodFile = goodDir.get_child('match-good.txt');
    goodFile.replace_contents('good', null, false, Gio.FileCreateFlags.NONE, null);

    const failingDir = tmpDir.get_child('failing');
    failingDir.make_directory(null);
    const failingFile = failingDir.get_child('match-failing.txt');
    failingFile.replace_contents('bad', null, false, Gio.FileCreateFlags.NONE, null);

    try {
        const scanner = new FileScanner(tmpBase);
        const originalEnumerateRecursive = scanner._enumerateRecursive.bind(scanner);

        scanner._enumerateRecursive = async function (directory, ...args) {
            if (directory.get_basename() === 'failing') {
                const proc = Gio.Subprocess.new(['rm', '-rf', directory.get_path()], Gio.SubprocessFlags.NONE);
                proc.wait(null);
            }

            return originalEnumerateRecursive(directory, ...args);
        };

        const results = await scanner.scan('match');
        const names = results.map(r => r.name);

        if (!names.includes('match-good.txt')) {
            throw new Error('Expected to find match-good.txt from sibling branch');
        }

        if (names.includes('match-failing.txt')) {
            throw new Error('Did not expect results from removed failing branch');
        }
    } finally {
        const proc = Gio.Subprocess.new(['rm', '-rf', tmpBase], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    }
});

await runner.run();
console.log('All tests finished.');
