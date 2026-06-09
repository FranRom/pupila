import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoleInterests } from './RoleInterests.tsx';
import type { RoleInterest } from './types.ts';

const FE: RoleInterest = {
  id: 'frontend-engineer',
  label: 'Frontend Engineer',
  titleMatch: ['frontend engineer'],
};

describe('RoleInterests', () => {
  it('renders a chip per role', () => {
    render(<RoleInterests roles={[FE]} loading={false} saving={false} onSave={vi.fn()} />);
    expect(screen.getByText('Frontend Engineer')).toBeInTheDocument();
  });

  it('adds a role, deriving id + titleMatch from the typed label', () => {
    const onSave = vi.fn();
    render(<RoleInterests roles={[]} loading={false} saving={false} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/Add a role/), {
      target: { value: 'Product Engineer' },
    });
    fireEvent.click(screen.getByText('Add role'));
    expect(onSave).toHaveBeenCalledWith([
      { id: 'product-engineer', label: 'Product Engineer', titleMatch: ['product engineer'] },
    ]);
  });

  it('removes a role', () => {
    const onSave = vi.fn();
    render(<RoleInterests roles={[FE]} loading={false} saving={false} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Remove Frontend Engineer'));
    expect(onSave).toHaveBeenCalledWith([]);
  });

  it('does not add a duplicate role id', () => {
    const onSave = vi.fn();
    render(<RoleInterests roles={[FE]} loading={false} saving={false} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/Add a role/), {
      target: { value: 'frontend engineer' },
    });
    fireEvent.click(screen.getByText('Add role'));
    expect(onSave).not.toHaveBeenCalled();
  });
});
