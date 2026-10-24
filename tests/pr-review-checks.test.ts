import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMain } from '../scripts/_is-main.js';
import {
  type ChangedFile,
  dependencyFieldsChanged,
  formatSummary,
  ignoredByBase,
  parseNumstat,
  reviewChanges,
} from '../scripts/pr-review-checks.js';

const f = (path: string, added = 10, deleted = 0, status = 'M'): ChangedFile => ({
  path,
  status,
  added,
  deleted,
});
const rules = (files: ChangedFile[], max?: number) =>
  reviewChanges(files, max).map((x) => `${x.level}:${x.rule}`);

describe('reviewChanges', () => {
  it('has nothing to say about a code change that ships with tests', () => {
    expect(rules([f('src/filters.ts'), f('tests/filters.test.ts')])).toEqual([]);
  });

  it('errors when personal data would be committed', () => {
    for (const p of [
      'config/applied.json',
      'config/candidate-brief.md',
      'config/profile.json',
      'config/cv.pdf',
      'config/slugs.local.json',
      'data/favorites.json',
      'data/applications/acme.md',
      'data/ai-reviews.json',
    ]) {
      expect(rules([f(p)]), p).toEqual(['error:personal-data']);
    }
  });

  it('does not flag the committed defaults or .gitkeep placeholders', () => {
    expect(
      rules([
        f('config/profile.default.json'),
        f('config/slugs.json'),
        f('data/applications/.gitkeep'),
        f('data/raw/.gitkeep'),
      ]),
    ).toEqual([]);
  });

  it('lets a PR delete a file that should never have been committed', () => {
    expect(rules([f('config/applied.json', 0, 5, 'D')])).toEqual([]);
  });

  it('warns when source changes without any test change', () => {
    expect(rules([f('src/normalize.ts')])).toEqual(['warning:tests-with-code']);
    expect(rules([f('ui/src/App.tsx')])).toEqual(['warning:tests-with-code']);
  });

  it('accepts a co-located UI test as the matching test', () => {
    expect(rules([f('ui/src/App.tsx'), f('ui/src/App.test.tsx')])).toEqual([]);
  });

  it('ignores docs-only and test-only changes', () => {
    expect(rules([f('README.md'), f('docs/guide.md')])).toEqual([]);
    expect(rules([f('tests/filters.test.ts')])).toEqual([]);
  });

  it('warns about generated output', () => {
    expect(rules([f('JOBS.md'), f('data/jobs.json')])).toEqual(['warning:generated-output']);
  });

  it('wants the README updated with an MCP tool change', () => {
    const tool = [f('src/mcp/tools/x.ts'), f('tests/mcp/x.test.ts')];
    expect(rules(tool)).toEqual(['warning:mcp-readme']);
    expect(rules([...tool, f('README.md')])).toEqual([]);
  });

  it('wants the lockfile with a dependency change in package.json', () => {
    expect(rules([f('package.json')])).toEqual(['warning:lockfile']);
    expect(rules([{ ...f('package.json'), depsChanged: true }])).toEqual(['warning:lockfile']);
    expect(rules([f('package.json'), f('pnpm-lock.yaml')])).toEqual([]);
  });

  it('does not ask for the lockfile when only scripts changed', () => {
    expect(rules([{ ...f('package.json'), depsChanged: false }])).toEqual([]);
  });

  it('flags workflow changes for a closer maintainer read', () => {
    expect(rules([f('.github/workflows/check.yml')])).toEqual(['warning:workflows']);
  });

  it('does not count the lockfile or generated files toward PR size', () => {
    expect(
      rules(
        [f('pnpm-lock.yaml', 3000, 0), f('data/jobs.json', 4000, 0), f('docs/a.md', 100, 0)],
        1500,
      ),
    ).toContain('warning:generated-output');
    expect(rules([f('pnpm-lock.yaml', 3000, 0), f('docs/a.md', 100, 0)], 1500)).toEqual([]);
  });

  it('flags very large PRs', () => {
    expect(rules([f('docs/a.md', 900, 700)], 1500)).toEqual(['warning:size']);
    expect(rules([f('docs/a.md', 900, 500)], 1500)).toEqual([]);
  });
});

describe('parseNumstat', () => {
  it('reads counts, statuses and binary files', () => {
    const files = parseNumstat(
      '12\t3\tsrc/a.ts\n-\t-\tdocs/img.png\n0\t40\tOLD.md\n',
      'M\tsrc/a.ts\nA\tdocs/img.png\nD\tOLD.md\n',
    );
    expect(files).toEqual([
      { path: 'src/a.ts', status: 'M', added: 12, deleted: 3 },
      { path: 'docs/img.png', status: 'A', added: 0, deleted: 0 },
      { path: 'OLD.md', status: 'D', added: 0, deleted: 40 },
    ]);
  });
});

describe('formatSummary', () => {
  it('says so when there are no findings', () => {
    expect(formatSummary([], 3)).toContain('No findings across 3 changed file(s)');
  });

  it('lists findings with their files, capped at 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
    const out = formatSummary(
      [{ level: 'warning', rule: 'tests-with-code', message: 'm', files: many }],
      12,
    );
    expect(out).toContain('Warning: `tests-with-code`');
    expect(out).toContain('`src/f9.ts`');
    expect(out).not.toContain('`src/f10.ts`');
    expect(out).toContain('…and 2 more');
  });
});

describe('dependencyFieldsChanged', () => {
  const pkg = (o: object) => JSON.stringify({ name: 'x', scripts: { a: 'b' }, ...o });

  it('ignores script and metadata edits', () => {
    expect(
      dependencyFieldsChanged(
        pkg({}),
        JSON.stringify({ name: 'x', version: '2', scripts: { a: 'c' } }),
      ),
    ).toBe(false);
  });

  it('sees added, changed and removed dependencies', () => {
    const base = pkg({ dependencies: { a: '1' } });
    expect(dependencyFieldsChanged(base, pkg({ dependencies: { a: '1', b: '1' } }))).toBe(true);
    expect(dependencyFieldsChanged(base, pkg({ dependencies: { a: '2' } }))).toBe(true);
    expect(dependencyFieldsChanged(base, pkg({}))).toBe(true);
    expect(dependencyFieldsChanged(pkg({}), pkg({ devDependencies: { z: '1' } }))).toBe(true);
  });

  it('treats unreadable JSON as changed', () => {
    expect(dependencyFieldsChanged('{', pkg({}))).toBe(true);
  });
});

describe('reviewChanges: personal data beyond the fixed list', () => {
  it('matches case-insensitively', () => {
    expect(rules([f('config/CV.PDF')])).toEqual(['error:personal-data']);
  });

  it('flags paths the base .gitignore ignores, even if the regex does not know them', () => {
    const ignored = new Set(['.env.local', 'data/archive/a.json']);
    const out = reviewChanges(
      [f('.env.local'), f('data/archive/a.json'), f('README.md')],
      1500,
      ignored,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.rule).toBe('personal-data');
    expect(out[0]?.files).toEqual(['.env.local', 'data/archive/a.json']);
  });
});

describe('reviewChanges: size', () => {
  it('counts deleted files toward the size threshold', () => {
    const out = reviewChanges([f('src/old.ts', 0, 3000, 'D'), f('tests/old.test.ts', 0, 10, 'D')]);
    expect(out.map((x) => x.rule)).toContain('size');
  });
});

describe('ignoredByBase', () => {
  it('reads the rules from the base ref, not the working tree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pupila-test-'));
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
        encoding: 'utf8',
      });
    try {
      git('init', '-q', '-b', 'main');
      writeFileSync(join(repo, '.gitignore'), '.env*\ndata/archive/\n');
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      // The "PR" un-ignores everything in its working tree.
      writeFileSync(join(repo, '.gitignore'), '');
      const cwd = process.cwd();
      process.chdir(repo);
      try {
        const hit = ignoredByBase('main', ['.env.local', 'data/archive/a.json', 'src/x.ts']);
        expect([...hit].sort()).toEqual(['.env.local', 'data/archive/a.json']);
        expect(ignoredByBase('main', []).size).toBe(0);
      } finally {
        process.chdir(cwd);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('isMain', () => {
  const self = fileURLToPath(new URL('../scripts/_is-main.ts', import.meta.url));
  const url = pathToFileURL(self).href;

  it('is true for the real path and false for another script', () => {
    expect(isMain(url, self)).toBe(true);
    expect(isMain(url, fileURLToPath(import.meta.url))).toBe(false);
    expect(isMain(url, undefined)).toBe(false);
  });

  it('is true when the entry point is reached through a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pupila-link-'));
    try {
      const link = join(dir, 'link.ts');
      symlinkSync(self, link);
      expect(isMain(url, link)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is false for a path that does not exist instead of throwing', () => {
    expect(isMain(url, '/nonexistent/path.ts')).toBe(false);
  });
});
