import { extractStructuredRecords, intentTerms, pickLinks, rankHits } from './heuristics';
import type { StructuredObjective } from '../core/types';

const objective: StructuredObjective = {
  target_entity: 'products',
  constraints: [],
  required_fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'price', type: 'number', required: true },
  ],
};
const embedded = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe('Deterministic discovery preserves recall', () => {
  it('keeps a single-domain frontier while giving other hosts priority', () => {
    const hits = Array.from({ length: 8 }, (_, index) => ({
      url: `https://catalog.example/items/${index}`,
      title: 'Relevant product',
      snippet: '',
    }));
    hits.push({ url: 'https://official.example/item', title: 'Relevant product', snippet: '' });
    const ranked = rankHits(hits, ['product'], [], 20);
    expect(ranked).toHaveLength(9);
    expect(ranked.slice(0, 4).some(hit => hit.url.includes('official.example'))).toBe(true);
  });

  it('preserves relevant profile sources and engine results with no keyword overlap', () => {
    const hits = [
      { url: 'https://linkedin.com/company/example', title: 'Research group', snippet: '' },
      { url: 'https://example.org/a', title: 'Unexpected wording', snippet: '' },
    ];
    expect(rankHits(hits, ['biotechnology'], [], 10)).toHaveLength(2);
  });

  it('deduplicates tracking variants and ignores unsafe URLs', () => {
    const hits = [
      'https://example.org/item',
      'https://example.org/item?utm_source=ad#top',
      'javascript:alert(1)',
      'http://example.org/item',
    ].map(url => ({ url, title: 'Product', snippet: '' }));
    expect(rankHits(hits, ['product'], [], 10)).toHaveLength(1);
    expect(rankHits(hits, ['product'], [], 0)).toEqual([]);
  });

  it('selects contact, pagination and opaque detail links while excluding account actions', () => {
    const links = ['/account/login', '/contact', '/items?page=2', '/locations/42'].map(
      (path, id) => ({
        id,
        url: 'https://example.org' + path,
        label: ['Login', 'Contact', 'Next', 'Dealer'][id],
      })
    );
    expect(pickLinks(links, ['televisions'], new Set(), 'https://example.org')).toHaveLength(3);
    expect(
      pickLinks(
        links,
        ['televisions'],
        new Set(['https://example.org/contact']),
        'https://example.org'
      ).some(link => link.label === 'Contact')
    ).toBe(false);
  });

  it('uses requested field descriptions for navigation relevance', () => {
    expect(
      intentTerms('Collect products', {
        ...objective,
        required_fields: [
          {
            name: 'price',
            type: 'number',
            required: true,
            description: 'Retail price and contact details',
          },
        ],
      })
    ).toContain('contact');
  });
});

describe('Literal structured extraction', () => {
  it('preserves enclosing context and escaped/whitespace source strings', () => {
    const data = { '@type': 'Product', name: '  Orbit "Pro"  ', price: 99 };
    const [record] = extractStructuredRecords(embedded(data), objective);
    expect(record.values).toEqual({ name: data.name, price: 99 });
    expect(record.evidence.name.context).toBe(JSON.stringify(data));
    expect(record.evidence.name.context).toContain(record.evidence.name.quote);
  });

  it('rejects competing title/name values instead of selecting by path length', () => {
    expect(
      extractStructuredRecords(embedded({ name: 'Orbit', title: 'Nova', price: 99 }), objective)
    ).toEqual([]);
  });

  it('does not equate salary with price or posting date with deadline', () => {
    const wanted = {
      ...objective,
      required_fields: [
        { name: 'price', type: 'number' as const, required: true },
        { name: 'deadline', type: 'date' as const, required: true },
      ],
    };
    expect(
      extractStructuredRecords(embedded({ salary: 99, datePosted: '2026-10-03' }), wanted)
    ).toEqual([]);
  });

  it('does not combine separate array entities into one complete record', () => {
    expect(
      extractStructuredRecords(embedded([{ name: 'Orbit' }, { price: 99 }]), objective)
    ).toEqual([]);
  });

  it('falls back on malformed or oversized entity data', () => {
    expect(
      extractStructuredRecords('<script type="application/ld+json">{broken}</script>', objective)
    ).toEqual([]);
    expect(
      extractStructuredRecords(
        embedded({ name: 'Orbit', price: 99, description: 'x'.repeat(7000) }),
        objective
      )
    ).toEqual([]);
  });
});
