import { describe, expect, it } from 'vitest';
import {
  type ChangedFile,
  dependencyFieldsChanged,
  formatSummary,
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
