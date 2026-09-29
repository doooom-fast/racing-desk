/**
 * The library as a git checkout: recognising the nesting, reading a real (temp) checkout, not pulling into a tree
 * with changes of its own, ignoring untracked files, a clone-push-check-fetch-pull cycle against a local bare remote,
 * and files that are in an update's way being set aside — moved, never deleted — before it. Every repo here is
 * created under os.tmpdir() by the test itself; nothing touches a real checkout. Port of the tests in
 * apps/paints/src-tauri/src/repo.rs plus suggestLibraries and the error texts.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repo = require('../../modules/js/paints/repo.js');
const paints = require('../../modules/js/paints/index.js');
const { run } = require('../../modules/js/paints/exec.js');
const { git } = repo;

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-repo-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function fixture(tag) {
  const dir = path.join(root, tag);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLibrary(dir, car = 'lotus79', version = 'v13') {
  const v = path.join(dir, car, version);
  fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(path.join(v, 'car_424242.tga'), 'paint');
  return v;
}

async function identity(dir) {
  await git(dir, ['config', 'user.email', 't@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
}

// A bare origin with one commit, pushed from `work`; returns both.
async function originWithWork(tag) {
  const origin = fixture(`${tag}-origin`);
  await git(origin, ['init', '--quiet', '--bare']);
  const work = fixture(`${tag}-work`);
  await git(work, ['clone', '--quiet', origin, '.']);
  await identity(work);
  makeLibrary(work);
  await git(work, ['add', '-A']);
  await git(work, ['commit', '--quiet', '-m', 'first livery']);
  await git(work, ['push', '--quiet', '-u', 'origin', 'HEAD']);
  return { origin, work };
}

async function pushNewLivery(work, car = 'nissangtpzxt', message = 'add the Nissan') {
  makeLibrary(work, car, 'v10');
  await git(work, ['add', '-A']);
  await git(work, ['commit', '--quiet', '-m', message]);
  await git(work, ['push', '--quiet']);
}

test.describe('looksLikeLibrary', () => {
  test('recognises the library nesting', () => {
    const dir = fixture('lib');
    makeLibrary(dir);
    expect(repo.looksLikeLibrary(dir)).toBe(true);
  });

  test('a sim paint folder is not a library', () => {
    // The sim's car folders hold textures directly, with no version layer. Without the nesting check,
    // suggestions would offer the paint folder as its own library.
    const dir = fixture('simpaint');
    fs.mkdirSync(path.join(dir, 'lotus79'));
    fs.writeFileSync(path.join(dir, 'lotus79', 'car_424242.tga'), 'paint');
    fs.writeFileSync(path.join(dir, 'lotus79', 'car_spec_424242.mip'), 'cooked');
    expect(repo.looksLikeLibrary(dir)).toBe(false);
  });

  test('an empty or missing folder is not a library', () => {
    const dir = fixture('empty');
    expect(repo.looksLikeLibrary(dir)).toBe(false);
    expect(repo.looksLikeLibrary(path.join(dir, 'nope'))).toBe(false);
  });
});

test.describe('git()', () => {
  test('an absent git, a failing command, and a failing command that said nothing', async () => {
    const absent = async () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn git ENOENT') });
    await expect(git('.', ['--version'], { exec: absent })).rejects.toThrow('Could not run git: spawn git ENOENT');
    const loud = async () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository\n', error: null });
    await expect(git('.', ['status'], { exec: loud })).rejects.toThrow('fatal: not a git repository');
    const mute = async () => ({ status: 1, stdout: '', stderr: '', error: null });
    await expect(git('.', ['rev-parse', 'HEAD'], { exec: mute })).rejects.toThrow('git rev-parse HEAD failed');
  });

  test('never stops for a credential prompt, and runs where it is told', async () => {
    let seen;
    const exec = async (file, args, opts) => { seen = { file, args, opts }; return { status: 0, stdout: ' out \n', stderr: '', error: null }; };
    expect(await git('C:\\somewhere', ['--version'], { exec })).toBe('out');
    expect(seen.file).toBe('git');
    expect(seen.opts.cwd).toBe('C:\\somewhere');
    expect(seen.opts.env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('without git nothing else is attempted, and the status says so', async () => {
    const absent = async () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn git ENOENT') });
    const st = await repo.status(fixture('nogit'), { exec: absent });
    expect(st.gitAvailable).toBe(false);
    expect(st.isRepo).toBe(false);
    expect(st.notes).toEqual(['git is not on this machine, so the library cannot be updated from a repo.']);
  });
});

test('a folder outside a repo reports no repo, with the full RepoStatus shape', async () => {
  const dir = fixture('norepo');
  makeLibrary(dir);
  const st = await repo.status(dir);
  expect(st.gitAvailable).toBe(true);   // git itself should be present wherever these tests run
  expect(st).toEqual({
    gitAvailable: true, isRepo: false, root: null, branch: null, upstream: null, remoteUrl: null, head: null,
    subject: null, dirty: false, behind: 0, ahead: 0, checkedRemote: false, updatesAvailable: false, notes: [],
  });
  expect(await repo.status(path.join(dir, 'missing'))).toMatchObject({ gitAvailable: true, isRepo: false });
  await expect(repo.check(dir)).rejects.toThrow('The library is not inside a git repository.');
  await expect(repo.pull(dir)).rejects.toThrow('The library is not inside a git repository.');
});

test('reads a real checkout and refuses to pull a dirty one', async () => {
  const dir = fixture('realrepo');
  // A repo with no upstream: enough to exercise everything but the network.
  await git(dir, ['init', '--quiet']);
  await identity(dir);
  const v = makeLibrary(dir);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '--quiet', '-m', 'first livery']);

  // Asked from a subfolder, the root is still the top of the work tree.
  const st = await repo.status(v);
  expect(st.isRepo).toBe(true);
  expect(path.resolve(st.root).toLowerCase()).toBe(path.resolve(dir).toLowerCase());
  expect(st.dirty).toBe(false);
  expect(st.subject).toBe('first livery');
  expect(st.head).toMatch(/^[0-9a-f]{7,}$/);
  expect(st.branch).toBeTruthy();
  // No upstream, so pulling has nothing to do and says so rather than failing oddly.
  expect(st.upstream).toBeNull();
  expect(st.notes).toEqual(['This branch is not tracking a remote, so there is nothing to update from.']);
  expect(await repo.check(dir)).toMatchObject({ checkedRemote: false, updatesAvailable: false });
  await expect(repo.pull(dir)).rejects.toThrow('This branch is not tracking a remote, so there is nothing to pull.');

  // Dirty it, and what is said is about his work, not about git.
  fs.writeFileSync(path.join(v, 'car_424242.tga'), 'edited');
  const dirty = await repo.status(dir);
  expect(dirty.dirty).toBe(true);
  expect(dirty.notes).toContain('The library has changes of its own that are not online, so updating is held back.');
});

test('untracked files do not block updating; a modified tracked file does', async () => {
  // This app writes backups, and other tools drop files in too. None of that can be lost to a fast-forward —
  // git refuses the pull itself if an incoming file would overwrite an untracked one. Counting them as dirty
  // meant a single apply switched updating off permanently, which is how this was found.
  const { work, origin } = await originWithWork('untracked');
  const clone = fixture('untracked-clone');
  await git(clone, ['clone', '--quiet', origin, '.']);

  // Something the app left behind, of the shape that caused the bug.
  const junk = path.join(clone, '.backups', 'lotus79', '2026-09-24_1200');
  fs.mkdirSync(junk, { recursive: true });
  fs.writeFileSync(path.join(junk, 'car_424242.tga'), 'a backup');
  expect((await repo.status(clone)).dirty).toBe(false);

  // A new livery upstream must still arrive.
  await pushNewLivery(work);
  const report = await repo.pull(clone);
  expect(report.updated).toBe(true);
  expect(fs.existsSync(path.join(clone, 'nissangtpzxt', 'v10'))).toBe(true);
  // And the untracked file is still sitting there, untouched.
  expect(fs.readFileSync(path.join(junk, 'car_424242.tga'), 'utf8')).toBe('a backup');

  // A modified *tracked* file is a real reason to hold back, and still does — once there is something to take.
  fs.writeFileSync(path.join(clone, 'lotus79', 'v13', 'car_424242.tga'), 'edited by hand');
  expect((await repo.status(clone)).dirty).toBe(true);
  expect(await repo.pull(clone)).toMatchObject({ updated: false, blocked: null });   // up to date: nothing to hold back
  await pushNewLivery(work, 'mx5', 'add the MX-5');
  const held = await repo.pull(clone);
  expect(held).toMatchObject({
    updated: false, commits: [], changed: 0, setAside: null,
    blocked: { reason: 'changes', text: 'The library has changes of its own that are not online, so it was not updated. Nothing was changed.' },
  });
  expect(fs.readFileSync(path.join(clone, 'lotus79', 'v13', 'car_424242.tga'), 'utf8')).toBe('edited by hand');
  expect(fs.existsSync(path.join(clone, 'mx5'))).toBe(false);
});

test('counts how far behind a checkout is: check asks, fetch counts, pull fast-forwards, again is a no-op', async () => {
  const { work, origin } = await originWithWork('behind');
  const clone = fixture('behind-clone');
  await git(clone, ['clone', '--quiet', origin, '.']);
  // A local clone could otherwise share the origin's object store, which would hide whether a check downloads.
  await git(clone, ['repack', '-a', '-d', '--quiet']).catch(() => {});

  const fresh = await repo.status(clone);
  expect(fresh.behind).toBe(0);
  expect(fresh.upstream).toMatch(/^origin\//);
  expect(path.resolve(fresh.remoteUrl).toLowerCase()).toBe(path.resolve(origin).toLowerCase());
  const same = await repo.check(clone);
  expect(same).toMatchObject({ checkedRemote: true, updatesAvailable: false, behind: 0 });

  // A new livery lands upstream.
  await pushNewLivery(work);

  // The cheap check must spot it while transferring nothing. Proof that nothing was downloaded: the commit's
  // object is still not here afterwards.
  const checked = await repo.check(clone);
  expect(checked.checkedRemote).toBe(true);
  expect(checked.updatesAvailable).toBe(true);
  expect(checked.behind).toBe(0);   // cannot be counted without downloading; the honest answer is "something"
  const tip = await repo.remoteTip(clone, checked.upstream);
  expect(tip).toMatch(/^[0-9a-f]{40}$/);
  expect(await repo.hasObject(clone, tip)).toBe(false);

  const fetched = await repo.fetch(clone);
  expect(fetched.behind).toBe(1);
  expect(fetched.ahead).toBe(0);
  expect(fetched.updatesAvailable).toBe(true);

  // Once the objects are here the count is exact.
  const counted = await repo.check(clone);
  expect(counted.behind).toBe(1);
  expect(counted.updatesAvailable).toBe(true);

  const report = await repo.pull(clone);
  expect(report.updated).toBe(true);
  expect(report.commits).toHaveLength(1);
  expect(report.commits[0]).toMatch(/^[0-9a-f]{7,} add the Nissan$/);
  expect(report.changed).toBe(1);   // one version of one car
  expect(report.setAside).toBeNull();
  expect(report.blocked).toBeNull();
  expect(report.status.behind).toBe(0);
  expect(report.status.updatesAvailable).toBe(false);
  expect(fs.existsSync(path.join(clone, 'nissangtpzxt', 'v10'))).toBe(true);

  // Pulling again is a no-op, not an error.
  const again = await repo.pull(clone);
  expect(again).toMatchObject({ updated: false, commits: [], changed: 0, setAside: null, blocked: null });
  expect(Object.keys(again).sort()).toEqual(['blocked', 'changed', 'commits', 'setAside', 'status', 'updated']);
});

test('a diverged branch is not updated, and what is said is plain and nothing changes', async () => {
  const { work, origin } = await originWithWork('diverged');
  const clone = fixture('diverged-clone');
  await git(clone, ['clone', '--quiet', origin, '.']);
  await identity(clone);
  // A local commit here, and a different one upstream.
  makeLibrary(clone, 'mx5', 'v1');
  await git(clone, ['add', '-A']);
  await git(clone, ['commit', '--quiet', '-m', 'local mx5']);
  await pushNewLivery(work);

  const report = await repo.pull(clone);
  expect(report).toMatchObject({
    updated: false, commits: [], changed: 0, setAside: null,
    blocked: { reason: 'work', text: 'The library has work of its own that is not online, so it was not updated. Nothing was changed.' },
  });
  expect(fs.existsSync(path.join(clone, 'nissangtpzxt'))).toBe(false);
  expect(fs.existsSync(path.join(clone, 'mx5', 'v1'))).toBe(true);
  expect(report.status).toMatchObject({ ahead: 1, behind: 1, dirty: false });
});

test('none of the sentences of what is in the way says how to use git', () => {
  expect(Object.keys(repo.BLOCKED)).toEqual(['changes', 'work', 'files', 'other']);
  for (const [reason, text] of Object.entries(repo.BLOCKED)) {
    expect(text, reason).not.toMatch(/\bgit\b|commit|stash|merge|rebase|pull|push|repo/i);
    expect(text, reason).toMatch(/Nothing was changed\.$/);
    expect(text.split('. ').length, `${reason} is one sentence, and that nothing was changed`).toBe(2);
  }
});

// ── Files in an update's way ─────────────────────────────────
// The fleet build writes paints into the library that the design pipeline pushes too: git will not write an incoming
// file over one it does not track. They are moved out of the checkout, whole, and the update goes ahead.

const WHEN = new Date(2026, 8, 29, 10, 15, 30);   // local time, as the folder's name is
const STAMP = '2026-09-29_101530';

// An origin with one livery, a clone of it, and — in `work` — a push of a version of the Nissan that the clone has
// already, untracked, under its own name for it: made here, as the fleet build makes one.
async function cloneWithFleetPaint(tag) {
  const { work, origin } = await originWithWork(tag);
  const clone = fixture(`${tag}-clone`);
  await git(clone, ['clone', '--quiet', origin, '.']);
  const theirs = path.join(work, 'nissangtpzxt', 'v10');
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, 'car_424242.tga'), 'from the design pipeline');
  fs.writeFileSync(path.join(theirs, 'meta.json'), '{"source":"pipeline"}');
  await git(work, ['add', '-A']);
  await git(work, ['commit', '--quiet', '-m', 'add the Nissan']);
  await git(work, ['push', '--quiet']);

  const mine = path.join(clone, 'nissangtpzxt', 'v10');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'car_424242.tga'), 'from the fleet build');
  fs.writeFileSync(path.join(mine, 'meta.json'), '{"source":"fleet"}');
  // Untracked, and in nobody's way: it stays where it is.
  fs.mkdirSync(path.join(clone, 'nissangtpzxt', 'v11'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'nissangtpzxt', 'v11', 'car_424242.tga'), 'a paint of my own');
  return { work, origin, clone };
}

test('files an update would write over are set aside, not deleted, and then it goes ahead', async () => {
  const { clone } = await cloneWithFleetPaint('aside');
  const base = fixture('aside-base');

  // Without somewhere to put them git refuses, as it always did: nothing is moved, and nothing is changed.
  const stuck = await repo.pull(clone);
  expect(stuck).toMatchObject({ updated: false, setAside: null, blocked: { reason: 'files', text: repo.BLOCKED.files } });
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the fleet build');
  expect((await repo.status(clone)).behind).toBe(1);

  const report = await repo.pull(clone, undefined, { setAsideBase: base, now: () => WHEN });
  expect(report.blocked).toBeNull();
  expect(report.updated).toBe(true);
  expect(report.changed).toBe(1);
  expect(report.commits).toHaveLength(1);
  const folder = path.join(base, STAMP);
  expect(report.setAside).toEqual({ count: 2, folder });

  // What came is the online copy's; what was there is whole, under the same path in the set-aside folder.
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the design pipeline');
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'meta.json'), 'utf8')).toBe('{"source":"pipeline"}');
  expect(fs.readFileSync(path.join(folder, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the fleet build');
  expect(fs.readFileSync(path.join(folder, 'nissangtpzxt', 'v10', 'meta.json'), 'utf8')).toBe('{"source":"fleet"}');
  // Only what was in the way: the untracked file that was in nobody's stays, and is not in the set-aside folder.
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v11', 'car_424242.tga'), 'utf8')).toBe('a paint of my own');
  expect(fs.existsSync(path.join(folder, 'nissangtpzxt', 'v11'))).toBe(false);
  expect(fs.readdirSync(base)).toEqual([STAMP]);
  expect(report.status).toMatchObject({ behind: 0, dirty: false });

  // Nothing waiting: nothing set aside, and no folder made for it.
  const again = await repo.pull(clone, undefined, { setAsideBase: base, now: () => WHEN });
  expect(again).toMatchObject({ updated: false, setAside: null, blocked: null });
  expect(fs.readdirSync(base)).toEqual([STAMP]);
});

test('nothing is set aside when nothing is in the way, and two updates in one second have folders of their own', async () => {
  const { work, origin } = await originWithWork('aside-none');
  const clone = fixture('aside-none-clone');
  await git(clone, ['clone', '--quiet', origin, '.']);
  const base = path.join(fixture('aside-none-base'), 'library-set-aside');   // not there yet
  fs.mkdirSync(path.join(clone, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'elsewhere', 'notes.txt'), 'mine');
  await pushNewLivery(work);
  const first = await repo.pull(clone, undefined, { setAsideBase: base, now: () => WHEN });
  expect(first).toMatchObject({ updated: true, setAside: null, blocked: null });
  expect(fs.existsSync(base)).toBe(false);   // not even the folder for them

  // Two in one second: `-02`.
  for (const [n, car] of [[1, 'car1'], [2, 'car2']]) {
    fs.mkdirSync(path.join(clone, car, 'v1'), { recursive: true });
    fs.writeFileSync(path.join(clone, car, 'v1', 'car_424242.tga'), `mine ${n}`);
    makeLibrary(work, car, 'v1');
    await git(work, ['add', '-A']);
    await git(work, ['commit', '--quiet', '-m', `add ${car}`]);
    await git(work, ['push', '--quiet']);
    const done = await repo.pull(clone, undefined, { setAsideBase: base, now: () => WHEN });
    expect(done.setAside).toEqual({ count: 1, folder: path.join(base, n === 1 ? STAMP : `${STAMP}-02`) });
  }
  expect(fs.readdirSync(base).sort()).toEqual([STAMP, `${STAMP}-02`]);
  expect(fs.readFileSync(path.join(base, `${STAMP}-02`, 'car2', 'v1', 'car_424242.tga'), 'utf8')).toBe('mine 2');
  expect(fs.readFileSync(path.join(clone, 'elsewhere', 'notes.txt'), 'utf8')).toBe('mine');
});

test('a set-aside is put back when the update then fails, and the folder it made goes', async () => {
  const { clone } = await cloneWithFleetPaint('aside-back');
  const base = fixture('aside-back-base');
  // Git fails at the fast-forward, after the files were moved.
  const exec = async (file, args, opts) => {
    if (args[0] === 'merge') return { status: 128, stdout: '', stderr: 'fatal: something else entirely\nhint: try a different way', error: null };
    return run(file, args, opts);
  };
  const report = await repo.pull(clone, { exec }, { setAsideBase: base, now: () => WHEN });
  expect(report).toMatchObject({ updated: false, setAside: null, blocked: { reason: 'other', text: repo.BLOCKED.other } });
  expect(report.blocked.text).not.toContain('hint');
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the fleet build');
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'meta.json'), 'utf8')).toBe('{"source":"fleet"}');
  expect(fs.readdirSync(base)).toEqual([]);   // no folder left behind holding nothing
  expect((await repo.status(clone)).behind).toBe(1);
});

test('a file that cannot be moved leaves the others where they were, and the update is not taken', async () => {
  const { clone } = await cloneWithFleetPaint('aside-locked');
  const base = fixture('aside-locked-base');
  // The second file is held by another program: its move is refused, after the first one's went through.
  const renameSync = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(from).endsWith('meta.json') && String(to).startsWith(base)) {
      throw Object.assign(new Error('EBUSY: resource busy or locked, rename'), { code: 'EBUSY' });
    }
    return renameSync(from, to);
  };
  let report;
  try {
    report = await repo.pull(clone, undefined, { setAsideBase: base, now: () => WHEN });
  } finally {
    fs.renameSync = renameSync;
  }
  expect(report).toMatchObject({ updated: false, setAside: null, blocked: { reason: 'files', text: repo.BLOCKED.files } });
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the fleet build');
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'meta.json'), 'utf8')).toBe('{"source":"fleet"}');
  expect(fs.readdirSync(base)).toEqual([]);   // the first file went back, and the folder made for it is gone
  expect((await repo.status(clone)).behind).toBe(1);

  // Nowhere it could be made at all: the same, before anything is moved.
  const notAFolder = path.join(fixture('aside-locked-file'), 'library-set-aside');
  fs.writeFileSync(notAFolder, 'a file where the folder should be');
  expect(await repo.pull(clone, undefined, { setAsideBase: notAFolder, now: () => WHEN }))
    .toMatchObject({ updated: false, blocked: { reason: 'files' } });
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the fleet build');
});

test('the files in the way are the incoming paths that are untracked, and only those', async () => {
  const { clone } = await cloneWithFleetPaint('inway');
  await repo.fetch(clone);
  const incoming = (await git(clone, ['diff', '--name-only', '-z', 'HEAD..@{upstream}'])).split('\0').filter(Boolean);
  expect(incoming.sort()).toEqual(['nissangtpzxt/v10/car_424242.tga', 'nissangtpzxt/v10/meta.json']);
  expect((await repo.inTheWay(clone, incoming)).sort()).toEqual(['nissangtpzxt/v10/car_424242.tga', 'nissangtpzxt/v10/meta.json']);
  expect(await repo.inTheWay(clone, ['lotus79/v13/car_424242.tga', 'nissangtpzxt/v11/other.tga'])).toEqual([]);
  expect(await repo.inTheWay(clone, [])).toEqual([]);
  // A file git ignores is not in its way: it is written over without being asked.
  fs.writeFileSync(path.join(clone, '.gitignore'), '*.log\n');
  fs.writeFileSync(path.join(clone, 'incoming.log'), 'ignored');
  expect(await repo.inTheWay(clone, ['incoming.log'])).toEqual([]);
});

test('on Windows an untracked file is in the way of an incoming one that differs from it in case only', async () => {
  test.skip(process.platform !== 'win32', 'the disk tells the two names apart elsewhere');
  const { work, origin } = await originWithWork('case');
  const clone = fixture('case-clone');
  await git(clone, ['clone', '--quiet', origin, '.']);
  const base = fixture('case-base');
  makeLibrary(work, 'nissangtpzxt', 'v10');
  await git(work, ['add', '-A']);
  await git(work, ['commit', '--quiet', '-m', 'add the Nissan']);
  await git(work, ['push', '--quiet']);
  fs.mkdirSync(path.join(clone, 'NissanGTPZXT', 'V10'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'NissanGTPZXT', 'V10', 'CAR_424242.tga'), 'fleet');

  const report = await repo.pull(clone, undefined, { setAsideBase: base, now: () => WHEN });
  expect(report).toMatchObject({ updated: true, blocked: null, setAside: { count: 1 } });
  expect(fs.readFileSync(path.join(report.setAside.folder, 'NissanGTPZXT', 'V10', 'CAR_424242.tga'), 'utf8')).toBe('fleet');
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('paint');
});

test('the folder is named for the local time, to the second', () => {
  expect(repo.setAsideStamp(new Date(2026, 0, 5, 3, 4, 9))).toBe('2026-01-05_030409');
  expect(repo.setAsideStamp(WHEN)).toBe(STAMP);
});

test('the command hands the folder in from the app, and without one puts nothing aside', async () => {
  const { clone } = await cloneWithFleetPaint('command');
  const base = fixture('command-base');
  const none = paints.createCommands({});
  expect(await none.repoPull(clone)).toMatchObject({ updated: false, blocked: { reason: 'files' } });
  const lost = paints.createCommands({ setAside: () => '' });
  expect(await lost.repoPull(clone)).toMatchObject({ updated: false, blocked: { reason: 'files' } });
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the fleet build');

  const cmd = paints.createCommands({ setAside: () => base, now: () => WHEN });
  const report = await cmd.repoPull(clone);
  expect(report).toMatchObject({ updated: true, setAside: { count: 2, folder: path.join(base, STAMP) } });
  expect(fs.readFileSync(path.join(clone, 'nissangtpzxt', 'v10', 'car_424242.tga'), 'utf8')).toBe('from the design pipeline');
});

test('suggestLibraries finds a checkout in or beside the paint folder and under Documents\\GitHub, repos first', async () => {
  const home = fixture('suggest-home');
  const paint = path.join(home, 'Documents', 'iRacing', 'paint');
  // The sim's own folders: textures directly inside, never a library.
  fs.mkdirSync(path.join(paint, 'lotus79'), { recursive: true });
  fs.writeFileSync(path.join(paint, 'lotus79', 'car_424242.tga'), 'x');
  // A loose library dropped inside the paint folder.
  makeLibrary(path.join(paint, 'dropped-in'));
  // A checkout beside it, with the library under cars/.
  const beside = path.join(home, 'Documents', 'iRacing', 'liveries');
  makeLibrary(path.join(beside, 'cars'));
  makeLibrary(path.join(beside, 'cars'), 'mx5', 'v1');
  // A real repo under Documents\GitHub, cars/ inside — the shape the design pipeline produces.
  const gh = path.join(home, 'Documents', 'GitHub', 'my-liveries');
  makeLibrary(path.join(gh, 'cars'));
  await git(gh, ['init', '--quiet']);
  await identity(gh);
  await git(gh, ['add', '-A']);
  await git(gh, ['commit', '--quiet', '-m', 'liveries']);
  // Noise that must not be suggested.
  fs.mkdirSync(path.join(home, 'Documents', 'GitHub', 'not-a-library', 'src'), { recursive: true });

  const out = await repo.suggestLibraries(paint, { env: { USERPROFILE: home } });
  expect(out.map((s) => s.path)).toEqual([
    path.join(gh, 'cars'),             // the repo first
    path.join(beside, 'cars'),         // then by car count
    path.join(paint, 'dropped-in'),
  ]);
  expect(out[0]).toMatchObject({ cars: 1 });
  expect(out[0].repo.isRepo).toBe(true);
  expect(out[1]).toMatchObject({ cars: 2 });
  expect(out[1].repo.isRepo).toBe(false);
  expect(Object.keys(out[0]).sort()).toEqual(['cars', 'path', 'repo']);

  // Nowhere to look is an empty list, not an error.
  expect(await repo.suggestLibraries(path.join(home, 'nope', 'paint'), { env: {} })).toEqual([]);
});
