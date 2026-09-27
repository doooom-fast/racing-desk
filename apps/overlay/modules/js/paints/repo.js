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
// Nothing here can lose work. The only write operation is `pull --ff-only`, which refuses to merge or rebase,
// and it is refused outright if the working tree is dirty.
const fs = require('fs');
const path = require('path');
const roles = require('./roles');
const { run } = require('./exec');
const { refused, other, messageOf } = require('./error');

// Long enough for a fetch of a repo full of multi-megabyte textures on a slow line, short enough that a hung
// credential prompt does not wedge the UI for ever.
const NETWORK_TIMEOUT_SECS = 120;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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
    st.notes.push('The repository has uncommitted changes. Updating is held back so they are not disturbed.');
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

// Fast-forward the library to the remote. `--ff-only` is the whole safety story: if the branches have diverged
// git stops rather than inventing a merge, and a dirty tree is refused before git is asked at all.
async function pull(p, deps) {
  const before = await fetch(p, deps);
  if (!before.isRepo) throw refused('The library is not inside a git repository.');
  if (!before.upstream) throw refused('This branch is not tracking a remote, so there is nothing to pull.');
  if (before.dirty) {
    throw refused('The repository has uncommitted changes. Commit or stash them first — pulling over them could '
      + 'lose work.');
  }
  const root = before.root;

  if (before.behind === 0) return { updated: false, commits: [], status: before };

  // Capture what is about to arrive, while it is still only on the remote side.
  const log = await gitOpt(root, ['log', '--pretty=%h %s', '--no-merges', 'HEAD..@{upstream}'], deps);
  const commits = log ? log.split(/\r?\n/) : [];

  try {
    await git(root, ['pull', '--ff-only', '--quiet'], deps);
  } catch (e) {
    throw refused(`Could not fast-forward the library: ${messageOf(e)} Nothing was changed.`);
  }

  return { updated: true, commits, status: await status(p, deps) };
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
  NETWORK_TIMEOUT_SECS, git, gitOpt, gitAvailable, status, remoteTip, hasObject, isAncestor, check, fetch, pull,
  looksLikeLibrary, suggestLibraries,
};
