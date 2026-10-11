import { describe, expect, it } from 'vitest';
import { pickLatestHiringStory } from '../src/fetchers/hn-hiring.js';
import type { RawHnHit } from '../src/types.js';

function hit(overrides: Partial<RawHnHit> = {}): RawHnHit {
  return {
    objectID: '48747976',
    title: 'Ask HN: Who is hiring? (July 2026)',
    created_at: '2026-07-01T15:01:21.000Z',
    ...overrides,
  } as RawHnHit;
}

describe('pickLatestHiringStory', () => {
  it('picks the hiring thread out of a mixed result set', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: '1', title: 'Ask HN: Who wants to be hired? (July 2026)' }),
      hit(),
      hit({ objectID: '2', title: 'Show HN: my job board' }),
    ]);
    expect(picked?.objectID).toBe('48747976');
  });

  it('never returns the sibling "who wants to be hired" thread', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: '1', title: 'Ask HN: Who wants to be hired? (July 2026)' }),
      hit({ objectID: '2', title: 'Ask HN: Freelancer? Seeking freelancer? (July 2026)' }),
    ]);
    expect(picked).toBeNull();
  });

  it('picks the newest when several months are present', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: 'may', created_at: '2026-05-01T15:00:07.000Z' }),
      hit({ objectID: 'july', created_at: '2026-07-01T15:01:21.000Z' }),
      hit({ objectID: 'june', created_at: '2026-06-01T15:00:00.000Z' }),
    ]);
    expect(picked?.objectID).toBe('july');
  });

  // The regression: a month-old thread must still be found. Under the old
  // 5-result free-text window it had been pushed out by newer unrelated stories,
  // so the source silently returned zero for most of every month.
  it('still finds a month-old thread buried among newer unrelated stories', () => {
    const noise = Array.from({ length: 25 }, (_, i) =>
      hit({
        objectID: `noise-${i}`,
        title: `Ask HN: is anyone hiring juniors? (${i})`,
        created_at: `2026-07-${String(20 + (i % 8)).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const picked = pickLatestHiringStory([...noise, hit()]);
    expect(picked?.objectID).toBe('48747976');
  });

  it('returns null on an empty or title-less result set', () => {
    expect(pickLatestHiringStory([])).toBeNull();
    expect(pickLatestHiringStory([hit({ title: undefined })])).toBeNull();
  });

  it('tolerates an unparseable created_at without throwing', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: 'bad', created_at: 'not-a-date' }),
      hit({ objectID: 'good' }),
    ]);
    expect(picked).not.toBeNull();
  });
});
