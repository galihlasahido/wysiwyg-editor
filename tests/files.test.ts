import { describe, expect, it } from 'vitest';
import { MemoryFileStore, cleanFileName, fileKind, isRasterImage, uniqueName } from '../src/files';

describe('file helpers', () => {
  it('cleans names: no path, no control characters, no leading dots, bounded length with the extension kept', () => {
    expect(cleanFileName('C:\\Users\\me\\..\\evil<>.png')).toBe('evil.png');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('  spaced   out .txt ')).toBe('spaced out .txt');
    expect(cleanFileName('...')).toBe('file');
    expect(cleanFileName('')).toBe('file');
    const long = cleanFileName(`${'a'.repeat(300)}.jpeg`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.jpeg')).toBe(true);
  });
  it('makes names unique like a file manager', () => {
    expect(uniqueName('a.png', ['b.png'])).toBe('a.png');
    expect(uniqueName('a.png', ['A.PNG'])).toBe('a (2).png');
    expect(uniqueName('a.png', ['a.png', 'a (2).png'])).toBe('a (3).png');
    expect(uniqueName('notes', ['notes'])).toBe('notes (2)');
  });
  it('classifies files', () => {
    expect(fileKind('image/png')).toBe('image');
    expect(fileKind('', 'report.pdf')).toBe('pdf');
    expect(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('document');
    expect(fileKind('text/csv', 'a.csv')).toBe('sheet');
    expect(fileKind('application/zip')).toBe('archive');
    expect(fileKind('application/octet-stream', 'x.bin')).toBe('other');
    expect(isRasterImage('image/png')).toBe(true);
    expect(isRasterImage('image/svg+xml')).toBe(false); // SVG is listed, but never edited or embedded as a picture
  });
});

describe('MemoryFileStore', () => {
  it('stores, lists, renames, replaces and removes', async () => {
    const s = new MemoryFileStore();
    const a = await s.put(new Blob(['hello'], { type: 'text/plain' }), { name: 'hi.txt' });
    expect(a).toMatchObject({ name: 'hi.txt', type: 'text/plain', size: 5 });
    expect((await s.list()).map((f) => f.name)).toEqual(['hi.txt']);
    expect((await s.update(a.id, { name: '../x/renamed.txt' }))!.name).toBe('renamed.txt');
    const r = await s.replace(a.id, new Blob(['hello world'], { type: 'text/plain' }), { width: 3, height: 4 });
    expect(r).toMatchObject({ size: 11, width: 3, height: 4, name: 'renamed.txt' });
    expect((await s.get(a.id))!.blob.size).toBe(11);
    expect((await s.usage!()).used).toBe(11);
    expect(await s.remove(a.id)).toBe(true);
    expect(await s.remove(a.id)).toBe(false);
    expect(await s.get(a.id)).toBeNull();
    expect(await s.update('nope', { name: 'x' })).toBeNull();
  });
});

describe('ResilientFileStore', () => {
  it('switches to the fallback when the primary fails, and keeps working', async () => {
    const { ResilientFileStore } = await import('../src/files');
    const broken = { list: async () => [], get: async () => null, put: async () => { throw new Error('Error preparing Blob/File data to be stored in object store'); }, update: async () => null, replace: async () => null, remove: async () => false };
    let warned: unknown = null;
    const s = new ResilientFileStore(broken, new MemoryFileStore(), (e) => (warned = e));
    expect(s.degraded).toBe(false);
    const rec = await s.put(new Blob(['x'], { type: 'text/plain' }), { name: 'a.txt' }); // fails over, then succeeds
    expect(rec.name).toBe('a.txt');
    expect(s.degraded).toBe(true);
    expect(warned).toBeInstanceOf(Error);
    expect((await s.list()).map((f) => f.name)).toEqual(['a.txt']);
    expect((await s.get(rec.id))!.blob.size).toBe(1);
    expect((await s.usage()).used).toBe(1);
  });
});
