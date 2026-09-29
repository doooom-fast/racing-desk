// The library as a git checkout, so new liveries arrive by pulling rather than copying. Ported from
// apps/paints/src-tauri/src/repo.rs.
//
// The design pipeline commits finished paints to a repo; this app reads that repo's cars/ folder as its library.
// Keeping the two in step is then a `git pull`, and the app can say whether one is due without the user going
// to look.
//
// Git is driven through the `git` command rather than a library. It is already on the machine, and more
// importantly it already knows the user's credentials through their credential helper — a linked-in
// implementation would have to ask for them again.
//
// Nothing here can lose work. The only write to the library is a fast-forward (`merge --ff-only` of what was just
// fetched), which refuses to merge or rebase, and it is refused outright if the working tree has changes of its own.
// What is in the way of one — files git does not track that an incoming file would be written over — is moved,
// never deleted, into a folder of its own beside the app's other data (`setAside`), and put back if the update then
// fails.
const fs = require('fs');
const path = require('path');
const roles = require('./roles');
const { run } = require('./exec');
const { refused, other, messageOf } = require('./error');

// Long enough for a fetch of a repo full of multi-megabyte textures on a slow line, short enough that a hung
// credential prompt does not wedge the UI for ever.
const NETWORK_TIMEOUT_SECS = 120;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// What stands in the way of an update that cannot be taken by itself, as it is shown: one plain sentence, and that
// the library was left as it was. The page prints these as they are; none says how to put it right with git.
const BLOCKED = Object.freeze({
  // Tracked files edited, or added or removed in the library, that the online copy does not have.
  changes: 'The library has changes of its own that are not online, so it was not updated. Nothing was changed.',
  // Commits the online copy does not have: the library is ahead of it, or the two have gone different ways.
  work: 'The library has work of its own that is not online, so it was not updated. Nothing was changed.',
  // Files that the update would write over, and that could not be moved aside (or there was nowhere to put them).
  files: 'Files in the library are in the way of the update and could not be moved aside, so it was not updated. '
    + 'Nothing was changed.',
  // Anything else git refused.
  other: 'The library could not be brought up to date just now, so it was not updated. Nothing was changed.',
});

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function emptyStatus() {
  return {
    gitAvailable: false,
    isRepo: false,
    root: null,
    branch: null,
    upstream: null,
    remoteUrl: null,
    head: null,
    subject: null,
    dirty: false,
    behind: 0,
    ahead: 0,
    checkedRemote: false,
    updatesAvailable: false,
    notes: [],
  };
}

// Run git in `dir` and hand back trimmed stdout, or throw the error git printed. Never stops for a username
// prompt: this runs behind a UI with nowhere to type.
async function git(dir, args, { exec = run } = {}) {
  const res = await exec('git', args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (res.error) throw other(`Could not run git: ${messageOf(res.error)}`);
  if (res.status !== 0) {
    const err = (res.stderr || '').trim();
    throw other(err || `git ${args.join(' ')} failed`);
  }
  return (res.stdout || '').trim();
}

// The same, but null instead of an error — for the many queries that are simply absent on a branch with no
// upstream or a repo with no commits.
async function gitOpt(dir, args, deps) {
  try {
    const out = await git(dir, args, deps);
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

async function gitAvailable(deps) {
  try {
    await git(process.cwd(), ['--version'], deps);
    return true;
  } catch (e) {
    return false;
  }
}

// Read the repository around `p` without touching the network. `behind` comes from the remote-tracking ref, so
// it is only as fresh as the last fetch; `fetch` refreshes it.
async function status(p, deps) {
  const st = emptyStatus();
  st.gitAvailable = await gitAvailable(deps);
  if (!st.gitAvailable) {
    st.notes.push('git is not on this machine, so the library cannot be updated from a repo.');
    return st;
  }
  if (!isDir(p)) return st;

  const root = await gitOpt(p, ['rev-parse', '--show-toplevel'], deps);
  if (!root) return st;   // not a work tree, which is fine — a library need not be one
  st.isRepo = true;
  st.root = root;

  st.branch = await gitOpt(root, ['rev-parse', '--abbrev-ref', 'HEAD'], deps);
  st.head = await gitOpt(root, ['rev-parse', '--short', 'HEAD'], deps);
  st.subject = await gitOpt(root, ['log', '-1', '--pretty=%s'], deps);
  // Tracked changes only. An untracked file cannot be lost to a fast-forward: git refuses the pull itself if an
  // incoming file would overwrite one, and reporting them as dirty meant anything sitting in the working tree —
  // including, at one point, this app's own backups — silently switched updating off for good.
  st.dirty = (await gitOpt(root, ['status', '--porcelain', '--untracked-files=no'], deps)) !== null;

  st.upstream = await gitOpt(root, ['rev-parse', '--abbrev-ref', '@{upstream}'], deps);
  if (st.upstream) {
    const remote = st.upstream.split('/')[0];
    st.remoteUrl = await gitOpt(root, ['remote', 'get-url', remote], deps);
    // left = commits only here, right = commits only upstream.
    const counts = await gitOpt(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], deps);
    if (counts) {
      const parts = counts.split(/\s+/);
      st.ahead = parseInt(parts[0], 10) || 0;
      st.behind = parseInt(parts[1], 10) || 0;
    }
  } else {
    st.notes.push('This branch is not tracking a remote, so there is nothing to update from.');
  }

  st.updatesAvailable = st.behind > 0;
  if (st.dirty) {
    st.notes.push('The library has changes of its own that are not online, so updating is held back.');
  }
  return st;
}

// Ask the remote for one branch tip. A few hundred bytes over the wire — it transfers no objects, which is what
// makes it safe to run on every launch.
async function remoteTip(root, upstream, deps) {
  const slash = upstream.indexOf('/');
  if (slash < 0) return null;
  const remote = upstream.slice(0, slash);
  const branch = upstream.slice(slash + 1);
  let out;
  try {
    out = await git(root, ['ls-remote', '--quiet', remote, `refs/heads/${branch}`], deps);
  } catch (e) {
    return null;
  }
  const first = out.split(/\s+/)[0];
  return first && first.length ? first : null;
}

async function hasObject(root, sha, deps) {
  try {
    await git(root, ['cat-file', '-e', `${sha}^{commit}`], deps);
    return true;
  } catch (e) {
    return false;
  }
}

// Is `sha` already contained in HEAD?
async function isAncestor(root, sha, deps) {
  try {
    await git(root, ['merge-base', '--is-ancestor', sha, 'HEAD'], deps);
    return true;
  } catch (e) {
    return false;
  }
}

// Ask the remote whether anything is waiting, without downloading it. `fetch` would answer the same question but
// pulls down every new object to do it — on a repo of multi-megabyte textures that is tens of megabytes,
// silently, every launch. This costs one small request, and only `pull` transfers anything.
async function check(p, deps) {
  const st = await status(p, deps);
  if (!st.isRepo) throw refused('The library is not inside a git repository.');
  if (!st.upstream) return st;   // nothing to check against; status already says so
  const root = st.root;

  const tip = await remoteTip(root, st.upstream, deps);
  if (!tip) {
    st.notes.push('Could not reach the remote to check for updates.');
    return st;
  }
  st.checkedRemote = true;

  const head = await gitOpt(root, ['rev-parse', 'HEAD'], deps);
  if (head === tip) {
    st.behind = 0;
    st.updatesAvailable = false;
    return st;
  }

  if (await hasObject(root, tip, deps)) {
    // The objects are already here, so the count is exact.
    st.updatesAvailable = !(await isAncestor(root, tip, deps));
    const count = await gitOpt(root, ['rev-list', '--count', `HEAD..${tip}`], deps);
    st.behind = count ? (parseInt(count, 10) || 0) : 0;
  } else {
    // Something new is up there. Counting it would mean downloading it.
    st.updatesAvailable = true;
  }
  return st;
}

// Ask the remote what it has. Read-only: it moves remote-tracking refs, never the work tree.
async function fetch(p, deps) {
  const st = await status(p, deps);
  if (!st.isRepo) throw refused('The library is not inside a git repository.');
  await git(st.root, ['-c', `http.lowSpeedTime=${NETWORK_TIMEOUT_SECS}`, 'fetch', '--quiet', '--prune'], deps);
  return status(p, deps);
}

const p2 = (n) => String(n).padStart(2, '0');

// yyyy-mm-dd_hhmmss in local time: the name of the folder one update's set-aside files go into.
function setAsideStamp(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`
    + `${p2(d.getSeconds())}`;
}

// The paths, from the checkout's root, that differ between here and the remote's copy — what an update touches.
// Names are read NUL-separated: git quotes anything unusual in a name any other way.
async function incomingFiles(root, deps) {
  const out = await gitOpt(root, ['diff', '--name-only', '-z', 'HEAD..@{upstream}'], deps);
  return out ? out.split('\0').filter(Boolean) : [];
}

// Which of the incoming files the checkout already has as files git does not track (and does not ignore): the ones
// git will not write over, and so stop an update. Compared without regard to case on Windows, where the disk does not
// tell `Cars` from `cars` and git may spell one as the other; the answer is spelled as the checkout has them.
async function inTheWay(root, incoming, deps) {
  if (!incoming.length) return [];
  const untracked = await gitOpt(root, ['ls-files', '--others', '--exclude-standard', '-z'], deps);
  if (!untracked) return [];
  const key = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  const here = new Map();
  for (const f of untracked.split('\0')) if (f) here.set(key(f), f);
  const out = new Set();
  for (const f of incoming) {
    const mine = here.get(key(f));
    if (mine !== undefined) out.add(mine);
  }
  return [...out];
}

// How many versions of a car the incoming files are in — `<library>/<car>/<version>/…` — for saying what arrived.
// Files outside the library (a checkout has more in it than cars/) and files straight under a car are not versions.
function changedVersions(libraryDir, root, files) {
  const seen = new Set();
  for (const f of files) {
    const rel = path.relative(libraryDir, path.join(root, f));
    if (path.isAbsolute(rel)) continue;
    const parts = rel.split(/[\\/]/);
    if (parts[0] === '..' || parts.length < 3) continue;
    seen.add(`${parts[0]}/${parts[1]}`.toLowerCase());
  }
  return seen.size;
}

// Move a file. Across volumes a rename is refused, so the file is copied, the copy checked to be whole, and only
// then is the original let go: at no moment is the only copy a partial one.
function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (!e || e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(to).size !== fs.statSync(from).size) {
      fs.unlinkSync(to);
      throw new Error(`${path.basename(from)} was not copied whole.`);
    }
    fs.unlinkSync(from);
  }
}

// Move each of `files` (paths from the checkout's root) out of the checkout into a new folder under `base`, at the
// same path, and say which folder and which files. Nothing is deleted. If one cannot be moved, those already moved
// are put back and the failure is thrown.
function setAside(root, files, base, when) {
  fs.mkdirSync(base, { recursive: true });
  const stamp = setAsideStamp(when);
  let folder = null;
  for (let n = 1; n <= 100 && folder === null; n++) {
    const candidate = path.join(base, n === 1 ? stamp : `${stamp}-${p2(n)}`);
    try {
      fs.mkdirSync(candidate);
      folder = candidate;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
  if (folder === null) throw other('Could not make a folder to set files aside in; 100 names in the same second were taken.');

  const moved = [];
  try {
    for (const rel of files) {
      const to = path.join(folder, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      moveFile(path.join(root, rel), to);
      moved.push(rel);
    }
  } catch (e) {
    putBack(root, folder, moved);
    throw e;
  }
  return { folder, files: moved };
}

// Put files that were set aside back where they were, and take away the folders that made, where nothing is left in
// them. Answers the files that could not be put back, which stay where they are in the set-aside folder.
function putBack(root, folder, files) {
  const stranded = [];
  for (const rel of [...files].reverse()) {
    try {
      moveFile(path.join(folder, rel), path.join(root, rel));
    } catch (e) {
      stranded.push(rel);
    }
  }
  for (const rel of files) {
    let dir = path.dirname(path.join(folder, rel));
    while (dir.length > folder.length) {
      try { fs.rmdirSync(dir); } catch (e) { break; }   // it is not empty: a file that could not be put back is in it
      dir = path.dirname(dir);
    }
  }
  try { fs.rmdirSync(folder); } catch (e) { /* something is still in it */ }
  return stranded;
}

// Bring the library up to the remote's copy, by a fast-forward and nothing else: if the branches have gone
// different ways git stops rather than inventing a merge, and a library with changes of its own is not touched.
// What is not an error is an answer — `blocked: { reason, text }` says, in words for the driver, what stands in the
// way, and that nothing was changed — so that a page can show it as it shows any state. What is an error is a call
// that makes no sense (not a checkout, no upstream) or git itself failing (no network).
//
// Files in the checkout that git does not track and that the update would write over are moved, not deleted, into
// `<setAsideBase>\<yyyy-mm-dd_hhmmss>\<their path in the checkout>` first — with no `setAsideBase` they stay and git
// refuses. The answer says how many and where (`setAside`), and if the update then fails they are put back.
//   { updated, commits, changed, setAside: { count, folder } | null, blocked: { reason, text } | null, status }
// `changed` is the number of versions of a car that arrived or changed.
async function pull(p, deps, { setAsideBase = null, now = () => new Date() } = {}) {
  const before = await fetch(p, deps);
  if (!before.isRepo) throw refused('The library is not inside a git repository.');
  if (!before.upstream) throw refused('This branch is not tracking a remote, so there is nothing to pull.');
  const root = before.root;
  const none = { updated: false, commits: [], changed: 0, setAside: null, blocked: null, status: before };
  const held = (reason, aside = null) => ({ ...none, setAside: aside, blocked: { reason, text: BLOCKED[reason] } });

  if (before.behind === 0) return none;
  if (before.dirty) return held('changes');
  if (before.ahead > 0) return held('work');

  // Capture what is about to arrive, while it is still only on the remote side.
  const log = await gitOpt(root, ['log', '--pretty=%h %s', '--no-merges', 'HEAD..@{upstream}'], deps);
  const commits = log ? log.split(/\r?\n/) : [];
  const incoming = await incomingFiles(root, deps);
  const changed = changedVersions(p, root, incoming);

  let aside = null;
  if (setAsideBase) {
    const inWay = await inTheWay(root, incoming, deps);
    if (inWay.length) {
      try {
        aside = setAside(root, inWay, setAsideBase, now());
      } catch (e) {
        return held('files');   // what was moved is back, so nothing was changed
      }
    }
  }

  try {
    // What was just fetched, and no more: not a second fetch that could bring in what was not looked at.
    await git(root, ['merge', '--ff-only', '--quiet', '@{upstream}'], deps);
  } catch (e) {
    const stranded = aside ? putBack(root, aside.folder, aside.files) : [];
    const kept = stranded.length ? { count: stranded.length, folder: aside.folder } : null;
    return held(/untracked working tree files/i.test(messageOf(e)) ? 'files' : 'other', kept);
  }

  return {
    updated: true,
    commits,
    changed,
    setAside: aside ? { count: aside.files.length, folder: aside.folder } : null,
    blocked: null,
    status: await status(p, deps),
  };
}

function dirEntries(p, limit) {
  try {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    return limit ? entries.slice(0, limit) : entries;
  } catch (e) {
    return null;
  }
}

// Does this folder look like a library — car folders holding version folders holding textures?
//
// The nesting is what makes this safe to run over the sim's own paint directory: a car folder there has textures
// directly inside it, not a layer of version folders, so it cannot be mistaken for a library root.
function looksLikeLibrary(p) {
  const cars = dirEntries(p, 200);
  if (!cars) return false;
  for (const car of cars) {
    if (!car.isDirectory()) continue;
    const versions = dirEntries(path.join(p, car.name), 200);
    if (!versions) continue;
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const files = dirEntries(path.join(p, car.name, version.name));
      if (!files) continue;
      for (const f of files) if (roles.parseLibraryFile(f.name)) return true;
    }
  }
  return false;
}

// Look for a library near the sim, so the common case needs no browsing. A checkout of the liveries repo
// sitting in or beside the paint folder is the shape the design pipeline already produces, and cars/ inside it
// is the library. Documents\GitHub is the usual home for checkouts on this kind of machine.
async function suggestLibraries(paintDir, { env = process.env, exec } = {}) {
  const deps = exec ? { exec } : undefined;
  const roots = [];
  const consider = (dir) => {
    if (!isDir(dir)) return;
    for (const candidate of [path.join(dir, 'cars'), dir]) {
      if (isDir(candidate) && !roots.includes(candidate)) roots.push(candidate);
    }
  };

  // A checkout dropped inside the paint folder, and one sitting alongside it.
  const bases = [paintDir];
  const parent = path.dirname(paintDir);
  if (parent && parent !== paintDir) bases.push(parent);
  for (const base of bases) {
    const entries = dirEntries(base, 400);
    if (!entries) continue;
    for (const e of entries) if (e.isDirectory()) consider(path.join(base, e.name));
  }
  if (typeof env.USERPROFILE === 'string' && env.USERPROFILE.length) {
    const github = path.join(env.USERPROFILE, 'Documents', 'GitHub');
    const entries = dirEntries(github, 200);
    if (entries) for (const e of entries) if (e.isDirectory()) consider(path.join(github, e.name));
  }

  const out = [];
  for (const p of roots) {
    if (!looksLikeLibrary(p)) continue;
    const entries = dirEntries(p);
    const cars = entries ? entries.filter((e) => e.isDirectory()).length : 0;
    out.push({ path: p, cars, repo: await status(p, deps) });
  }

  // A checkout that can be kept up to date is more useful than a loose folder.
  out.sort((a, b) => (Number(b.repo.isRepo) - Number(a.repo.isRepo)) || (b.cars - a.cars) || cmp(a.path, b.path));
  return out.slice(0, 6);
}

module.exports = {
  NETWORK_TIMEOUT_SECS, BLOCKED, git, gitOpt, gitAvailable, status, remoteTip, hasObject, isAncestor, check, fetch,
  pull, inTheWay, setAsideStamp, looksLikeLibrary, suggestLibraries,
};
