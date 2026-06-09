import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { JobSignals } from '../types.ts';
import { SignalChips } from './SignalChips.tsx';

const emptySignals: JobSignals = {
  web3TitleBody: 0,
  web3Stack: 0,
  aiTitleBody: 0,
  aiStack: 0,
  stackPrimary: 0,
  stackRn: 0,
  stackOther: 0,
  leadTitle: 0,
  seniorTitle: 0,
  roleTitle: 0,
  roleBody: 0,
  locationRemote: 0,
  freshness7d: 0,
  freshness14d: 0,
  usCentricPenalty: 0,
  rawTotal: 0,
  capped: false,
};

describe('SignalChips', () => {
  it('renders nothing when signals is undefined', () => {
    const { container } = render(<SignalChips signals={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no discriminating signal fired', () => {
    const { container } = render(<SignalChips signals={emptySignals} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('skips universal/freshness/penalty signals even when non-zero', () => {
    // leadTitle / seniorTitle / locationRemote / freshness / penalty are all
    // intentionally excluded from CHIP_LABELS — including them at row level
    // would crowd the actually-discriminating chips.
    const { container } = render(
      <SignalChips
        signals={{
          ...emptySignals,
          leadTitle: 15,
          seniorTitle: 10,
          locationRemote: 10,
          freshness7d: 10,
          freshness14d: 5,
          usCentricPenalty: -10,
          rawTotal: 40,
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders fired chips with label + "+value" suffix', () => {
    render(<SignalChips signals={{ ...emptySignals, web3TitleBody: 20, aiStack: 20 }} />);
    expect(screen.getByText('web3 +20')).toBeInTheDocument();
    expect(screen.getByText('ai stack +20')).toBeInTheDocument();
  });

  it('sorts chips by signal value descending', () => {
    render(
      <SignalChips
        signals={{
          ...emptySignals,
          stackPrimary: 10,
          web3TitleBody: 20,
          roleBody: 5,
        }}
      />,
    );
    const chips = screen.getAllByTitle(/contributed \+\d+ to the fit score/);
    expect(chips).toHaveLength(3);
    expect(chips[0]?.textContent).toContain('web3 +20');
    expect(chips[1]?.textContent).toContain('react/ts +10');
    expect(chips[2]?.textContent).toContain('role body +5');
  });

  it('truncates to the top `max` chips (default 3)', () => {
    render(
      <SignalChips
        signals={{
          ...emptySignals,
          web3TitleBody: 20,
          web3Stack: 20,
          aiTitleBody: 20,
          aiStack: 20,
          stackPrimary: 10,
        }}
      />,
    );
    const chips = screen.getAllByTitle(/contributed \+\d+/);
    expect(chips).toHaveLength(3);
  });

  it('honors a custom `max` prop', () => {
    render(
      <SignalChips
        max={5}
        signals={{
          ...emptySignals,
          web3TitleBody: 20,
          web3Stack: 20,
          aiTitleBody: 20,
          aiStack: 20,
          stackPrimary: 10,
        }}
      />,
    );
    const chips = screen.getAllByTitle(/contributed \+\d+/);
    expect(chips).toHaveLength(5);
  });
});
