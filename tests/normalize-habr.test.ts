import { describe, expect, it } from 'vitest';
import { normalizeHabr } from '../src/normalize.js';
import type { RawRssItem } from '../src/types.js';

const NOW = '2026-08-16T00:00:00.000Z';

function item(overrides: Partial<RawRssItem> = {}): RawRssItem {
  return {
    title: 'Требуется « Java Developer» (Москва)',
    link: 'https://career.habr.com/vacancies/1000165261',
    guid: '1000165261',
    description:
      'Компания «ИТ-компания «Лоция»» ищет хорошего специалиста на вакансию « Java Developer». Москва (Россия). Полный рабочий день. Можно удалённо. Требуемые навыки: #middle, #Java, #Gradle, #ApacheKafka.',
    author: 'ИТ-компания «Лоция»',
    pubDate: 'Sun, 16 Aug 2026 07:34:45 +0300',
    ...overrides,
  };
}

describe('normalizeHabr', () => {
  it('extracts role, city, and company from the formulaic title/author', () => {
    const [job] = normalizeHabr([item()], NOW);
    expect(job?.title).toBe('Java Developer');
    expect(job?.location).toBe('Москва');
    expect(job?.company).toBe('ИТ-компания «Лоция»');
    expect(job?.url).toBe('https://career.habr.com/vacancies/1000165261');
    expect(job?.remote).toBe(true);
    expect(job?.source).toBe('habr');
  });

  it('collects #hashtag skills into tags', () => {
    const [job] = normalizeHabr([item()], NOW);
    expect(job?.tags).toContain('Java');
    expect(job?.tags).toContain('ApacheKafka');
  });

  it('handles a title without a city segment', () => {
    const [job] = normalizeHabr([item({ title: 'Требуется «Senior Frontend Engineer»' })], NOW);
    expect(job?.title).toBe('Senior Frontend Engineer');
    expect(job?.location).toBeNull();
  });

  it('falls back to the raw title when the pattern does not match', () => {
    const [job] = normalizeHabr([item({ title: 'Some other title' })], NOW);
    expect(job?.title).toBe('Some other title');
  });

  it('skips items without a link', () => {
    expect(normalizeHabr([item({ link: undefined, guid: undefined })], NOW)).toHaveLength(0);
  });
});

describe('normalizeHabr — salary inside the city segment', () => {
  it('splits the salary off the location and keeps it', () => {
    const [job] = normalizeHabr(
      [
        item({
          title: 'Требуется «Коммерческий директор (IT / SaaS)» (Владивосток, от 200 000 ₽)',
        }),
      ],
      NOW,
    );
    expect(job?.title).toBe('Коммерческий директор (IT / SaaS)');
    expect(job?.location).toBe('Владивосток');
    expect(job?.salary).toBe('от 200 000 ₽');
    expect(job?.salaryMin).toBe(200000);
  });

  it('leaves a plain city untouched and has no salary', () => {
    const [job] = normalizeHabr([item()], NOW);
    expect(job?.location).toBe('Москва');
    expect(job?.salary).toBeNull();
  });
});
