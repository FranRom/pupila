import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SourcesResponse, VerifyResponse } from '../lib/api/index.ts';
import { SourcesPanel } from './SourcesPanel.tsx';

afterEach(() => vi.restoreAllMocks());

const sources: SourcesResponse = {
  ats: [
    {
      key: 'ashby',
      label: 'Ashby',
      verifySupported: true,
      shipped: ['linear', 'ramp'],
      add: ['stripe'],
      remove: [],
      effective: ['linear', 'ramp', 'stripe'],
    },
  ],
};

const noopVerify = async (): Promise<VerifyResponse | null> => ({ supported: true, found: 3 });

it('renders the effective company list', () => {
  render(<SourcesPanel sources={sources} onSave={vi.fn()} onVerify={noopVerify} />);
  expect(screen.getByText('linear')).toBeInTheDocument();
  expect(screen.getByText('stripe')).toBeInTheDocument();
});

it('removing a shipped slug saves it into the remove list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  fireEvent.click(screen.getByTitle('Remove linear'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['stripe'], ['linear']));
});

it('removing an added slug drops it from the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  fireEvent.click(screen.getByTitle('Remove stripe'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', [], []));
});

it('adding a new slug appends it to the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'Mercury' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['stripe', 'mercury'], []));
});

it('rejects an invalid slug without saving', async () => {
  const onSave = vi.fn();
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'bad/slug' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(await screen.findByText(/invalid slug/i)).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});
