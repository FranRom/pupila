import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoTooltip } from './InfoTooltip.tsx';

describe('InfoTooltip', () => {
  it('renders a trigger button with the given accessible label', () => {
    render(<InfoTooltip content="Regions you will work in." ariaLabel="About accepted regions" />);
    expect(screen.getByRole('button', { name: 'About accepted regions' })).toBeInTheDocument();
  });

  it('renders the tooltip content and links it to the trigger via aria-describedby', () => {
    render(<InfoTooltip content="Regions you will work in." />);
    const trigger = screen.getByRole('button');
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Regions you will work in.');
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
  });

  it('defaults the trigger label to "More information"', () => {
    render(<InfoTooltip content="x" />);
    expect(screen.getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });
});
