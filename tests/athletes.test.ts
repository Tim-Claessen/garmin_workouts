import { describe, expect, it } from 'vitest';
import { readRoster, selectAthlete, toPublic, type Athlete } from '../src/lib/athletes';

const ZOE: Athlete = {
  id: 'zoe',
  label: 'Zoe',
  athleteId: 'i123456',
  apiKey: 'zoe-key-abcdefgh',
};
const TIM: Athlete = {
  id: 'tim',
  label: 'Tim',
  athleteId: 'i652699',
  apiKey: 'tim-key-abcdefgh',
};

describe('readRoster', () => {
  it('reads a JSON roster', () => {
    const result = readRoster({ athletesJson: JSON.stringify([ZOE, TIM]) });
    expect(result.ok && result.athletes.map((a) => a.id)).toEqual(['zoe', 'tim']);
  });

  it('falls back to the legacy single-athlete bindings', () => {
    const result = readRoster({ athleteId: 'i652699', apiKey: 'legacy-key-1234' });
    expect(result.ok && result.athletes).toHaveLength(1);
    expect(result.ok && result.athletes[0]!.athleteId).toBe('i652699');
  });

  it('prefers the roster over the legacy bindings', () => {
    const result = readRoster({
      athletesJson: JSON.stringify([ZOE]),
      athleteId: 'i999999',
      apiKey: 'legacy-key-1234',
    });
    expect(result.ok && result.athletes[0]!.athleteId).toBe('i123456');
  });

  it('reports malformed JSON rather than falling back', () => {
    // Falling back here would silently send to the wrong calendar.
    const result = readRoster({
      athletesJson: '{not json',
      athleteId: 'i652699',
      apiKey: 'legacy-key-1234',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('rejects entries missing a key', () => {
    const result = readRoster({
      athletesJson: JSON.stringify([{ id: 'zoe', label: 'Zoe', athleteId: 'i1' }]),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_shape' });
  });

  it('rejects ids that are not slugs', () => {
    const result = readRoster({
      athletesJson: JSON.stringify([{ ...ZOE, id: 'Zoe Smith' }]),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_shape' });
  });

  it('reports when nothing is configured', () => {
    expect(readRoster({})).toEqual({ ok: false, reason: 'none_configured' });
  });

  it('drops duplicate ids but keeps roster order', () => {
    const result = readRoster({
      athletesJson: JSON.stringify([ZOE, TIM, { ...ZOE, label: 'Zoe again' }]),
    });
    expect(result.ok && result.athletes.map((a) => a.label)).toEqual(['Zoe', 'Tim']);
  });
});

describe('selectAthlete', () => {
  it('defaults to the first when no id is given', () => {
    expect(selectAthlete([ZOE, TIM], null)?.id).toBe('zoe');
  });

  it('selects by id', () => {
    expect(selectAthlete([ZOE, TIM], 'tim')?.id).toBe('tim');
  });

  it('returns nothing for an unknown id rather than defaulting', () => {
    // Silently sending to the wrong calendar is worse than failing the request.
    expect(selectAthlete([ZOE, TIM], 'nobody')).toBeNull();
  });
});

describe('toPublic', () => {
  it('never exposes credentials', () => {
    const published = toPublic(ZOE) as Record<string, unknown>;
    expect(Object.keys(published).sort()).toEqual(['id', 'label']);
    expect(JSON.stringify(published)).not.toContain('zoe-key');
    expect(JSON.stringify(published)).not.toContain('i123456');
  });
});
