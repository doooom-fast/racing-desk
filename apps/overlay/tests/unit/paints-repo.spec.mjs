/**
 * The library as a git checkout: recognising the nesting, reading a real (temp) checkout, refusing to pull a dirty
 * tree, ignoring untracked files, and a clone-push-check-fetch-pull cycle against a local bare remote. Every repo
 * here is created under os.tmpdir() by the test itself; nothing touches a real checkout. Port of the tests in
 * apps/paints/src-tauri/src/repo.rs plus suggestLibraries and the error texts.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repo = require('../../modules/js/paints/repo.js');
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
  fs.writeFileSync(path.join(v, 'car_1159839.tga'), 'paint');
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
    fs.writeFileSync(path.join(dir, 'lotus79', 'car_1159839.tga'), 'paint');
    fs.writeFileSync(path.join(dir, 'lotus79', 'car_spec_1159839.mip'), 'cooked');
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

  // Dirty it, and the refusal must mention the work rather than git internals.
  fs.writeFileSync(path.join(v, 'car_1159839.tga'), 'edited');
  const dirty = await repo.status(dir);
  expect(dirty.dirty).toBe(true);
  expect(dirty.notes).toContain('The repository has uncommitted changes. Updating is held back so they are not disturbed.');
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
  fs.writeFileSync(path.join(junk, 'car_1159839.tga'), 'a backup');
  expect((await repo.status(clone)).dirty).toBe(false);

  // A new livery upstream must still arrive.
  await pushNewLivery(work);
  const report = await repo.pull(clone);
  expect(report.updated).toBe(true);
  expect(fs.existsSync(path.join(clone, 'nissangtpzxt', 'v10'))).toBe(true);
  // And the untracked file is still sitting there, untouched.
  expect(fs.readFileSync(path.join(junk, 'car_1159839.tga'), 'utf8')).toBe('a backup');

  // A modified *tracked* file is a real reason to hold back, and still does.
  fs.writeFileSync(path.join(clone, 'lotus79', 'v13', 'car_1159839.tga'), 'edited by hand');
  expect((await repo.status(clone)).dirty).toBe(true);
  await expect(repo.pull(clone)).rejects.toThrow('The repository has uncommitted changes. Commit or stash them first — pulling over them could lose work.');
  expect(fs.readFileSync(path.join(clone, 'lotus79', 'v13', 'car_1159839.tga'), 'utf8')).toBe('edited by hand');
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
  expect(report.status.behind).toBe(0);
  expect(report.status.updatesAvailable).toBe(false);
  expect(fs.existsSync(path.join(clone, 'nissangtpzxt', 'v10'))).toBe(true);

  // Pulling again is a no-op, not an error.
  const again = await repo.pull(clone);
  expect(again).toMatchObject({ updated: false, commits: [] });
  expect(Object.keys(again).sort()).toEqual(['commits', 'status', 'updated']);
});

test('a diverged branch is refused by --ff-only, and nothing changes', async () => {
  const { work, origin } = await originWithWork('diverged');
  const clone = fixture('diverged-clone');
  await git(clone, ['clone', '--quiet', origin, '.']);
  await identity(clone);
  // A local commit here, and a different one upstream.
  makeLibrary(clone, 'mx5', 'v1');
  await git(clone, ['add', '-A']);
  await git(clone, ['commit', '--quiet', '-m', 'local mx5']);
  await pushNewLivery(work);

  const err = await repo.pull(clone).catch((e) => e);
  expect(err.kind).toBe('refused');
  // git's stderr comes through verbatim, hints and all, as it did from the Rust.
  expect(err.message).toMatch(/^Could not fast-forward the library: [\s\S]+ Nothing was changed\.$/);
  expect(err.message).toContain('Not possible to fast-forward');
  expect(fs.existsSync(path.join(clone, 'nissangtpzxt'))).toBe(false);
  expect((await repo.status(clone))).toMatchObject({ ahead: 1, behind: 1, dirty: false });
});

test('suggestLibraries finds a checkout in or beside the paint folder and under Documents\\GitHub, repos first', async () => {
  const home = fixture('suggest-home');
  const paint = path.join(home, 'Documents', 'iRacing', 'paint');
  // The sim's own folders: textures directly inside, never a library.
  fs.mkdirSync(path.join(paint, 'lotus79'), { recursive: true });
  fs.writeFileSync(path.join(paint, 'lotus79', 'car_1159839.tga'), 'x');
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
