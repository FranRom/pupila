import { describe, expect, it } from 'vitest';
import { normalizeRemoteYeah } from '../src/normalize.js';
import type { RawRemoteYeah } from '../src/types.js';

const FETCHED_AT = new Date('2026-06-11T00:00:00Z').toISOString();

// Mirrors what the shared RSS parser produces for a RemoteYeah <item>: custom
// <company>/<tags>/<location> tags, a CDATA <description> object, and a link
// whose `&` is XML-escaped as `&amp;` with utm/ref tracking params.
function rawItem(overrides: Partial<RawRemoteYeah> = {}): RawRemoteYeah {
  return {
    title: ' Remote Staff Backend Engineer at B2spin ',
    company: ' B2spin ',
    description: {
      '#cdata': '<ul><li>Skills: Java, Kafka</li></ul><h2>Description:</h2><p>Build things.</p>',
    },
    category: ' Back-end Engineer ',
    tags: 'Java, Kafka, Staff, Full-time',
    location: ' Ukraine ',
    pubDate: '2026-06-11T14:31:50+00:00',
    guid: { '#text': 'staff-backend-engineer-b2spin', '@_isPermaLink': 'false' },
    link: 'https://remoteyeah.com/jobs/remote-staff-backend-engineer-b2spin?utm_source=rss&amp;ref=rss',
    image: 'https://remoteyeah.com/assets/logo.png',
    ...overrides,
  };
}

describe('normalizeRemoteYeah', () => {
  it('maps the custom RemoteYeah tags onto a Job', () => {
    const [job] = normalizeRemoteYeah([rawItem()], FETCHED_AT);
    expect(job).toMatchObject({
      source: 'remoteyeah',
      title: 'Remote Staff Backend Engineer at B2spin',
      company: 'B2spin',
      location: 'Ukraine',
      remote: true,
      categories: [],
      fetchedAt: FETCHED_AT,
    });
    expect(job?.postedAt).toBe('2026-06-11T14:31:50.000Z');
  });

  it('extracts plain text from the CDATA description', () => {
    const [job] = normalizeRemoteYeah([rawItem()], FETCHED_AT);
    expect(job?.body).toContain('Skills: Java, Kafka');
    expect(job?.body).toContain('Build things.');
    expect(job?.body).not.toContain('<');
  });

  it('decodes &amp; and strips utm/ref tracking params from the URL', () => {
    const [job] = normalizeRemoteYeah([rawItem()], FETCHED_AT);
    expect(job?.url).toBe('https://remoteyeah.com/jobs/remote-staff-backend-engineer-b2spin');
  });

  it('splits the comma-separated tags and appends the category', () => {
    const [job] = normalizeRemoteYeah([rawItem()], FETCHED_AT);
    expect(job?.tags).toEqual(['Java', 'Kafka', 'Staff', 'Full-time', 'Back-end Engineer']);
  });

  it('extracts salary from the description prose when present', () => {
    const [job] = normalizeRemoteYeah(
      [
        rawItem({
          description: {
            '#cdata':
              '<p>About the role.</p><ul><li>Base salary range of $100K to $130K, adjusted by region.</li></ul>',
          },
        }),
      ],
      FETCHED_AT,
    );
    expect(job?.salaryMin).toBe(100000);
    expect(job?.salaryMax).toBe(130000);
    expect(job?.salaryCurrency).toBe('USD');
  });

  it('ignores a 401(k) mention so it is not parsed as a salary figure', () => {
    const [job] = normalizeRemoteYeah(
      [
        rawItem({
          description: {
            '#cdata': '<li>Salary range of $95,000 - $105,000 plus benefits, PTO, and 401k.</li>',
          },
        }),
      ],
      FETCHED_AT,
    );
    expect(job?.salaryMin).toBe(95000);
    expect(job?.salaryMax).toBe(105000);
  });

  it('leaves salary null when the body has a $ figure but no comp context', () => {
    const [job] = normalizeRemoteYeah(
      [
        rawItem({
          description: { '#cdata': '<p>We are a platform supplying over $1B worth of goods.</p>' },
        }),
      ],
      FETCHED_AT,
    );
    expect(job?.salary).toBeNull();
    expect(job?.salaryMin).toBeNull();
  });

  it('produces a stable sha1 id derived from the cleaned URL', () => {
    const a = normalizeRemoteYeah([rawItem()], FETCHED_AT)[0];
    // Same job, different tracking params on the link → same id.
    const b = normalizeRemoteYeah(
      [
        rawItem({
          link: 'https://remoteyeah.com/jobs/remote-staff-backend-engineer-b2spin?utm_source=x',
        }),
      ],
      FETCHED_AT,
    )[0];
    expect(a?.id).toMatch(/^[0-9a-f]{40}$/);
    expect(a?.id).toBe(b?.id);
  });

  it('handles a plain-string description and missing optional fields', () => {
    const [job] = normalizeRemoteYeah(
      [
        rawItem({
          description: 'Just a plain string body',
          company: undefined,
          location: undefined,
          category: undefined,
          tags: undefined,
        }),
      ],
      FETCHED_AT,
    );
    expect(job?.body).toBe('Just a plain string body');
    expect(job?.company).toBeNull();
    expect(job?.location).toBeNull();
    expect(job?.tags).toEqual([]);
  });

  it('drops items with no title or no link', () => {
    const jobs = normalizeRemoteYeah(
      [rawItem({ title: '   ' }), rawItem({ link: undefined }), rawItem()],
      FETCHED_AT,
    );
    expect(jobs).toHaveLength(1);
  });
});
