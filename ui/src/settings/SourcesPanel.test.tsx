import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SourceHealthResponse, SourcesResponse, VerifyResponse } from '../lib/api/index.ts';
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

const noopVerify = async (): Promise<VerifyResponse | null> => ({
  supported: true,
  state: 'ok',
  found: 3,
});
const noopHealth = async (): Promise<SourceHealthResponse | null> => ({ results: [] });

function renderPanel(overrides: Partial<Parameters<typeof SourcesPanel>[0]> = {}) {
  return render(
    <SourcesPanel
      sources={sources}
      onSave={vi.fn()}
      onVerify={noopVerify}
      onCheckHealth={noopHealth}
      {...overrides}
    />,
  );
}

it('renders the effective company list', () => {
  renderPanel();
  expect(screen.getByText('linear')).toBeInTheDocument();
  expect(screen.getByText('stripe')).toBeInTheDocument();
});

it('removing a shipped slug saves it into the remove list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderPanel({ onSave });
  fireEvent.click(screen.getByTitle('Remove linear'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['stripe'], ['linear']));
});

it('removing an added slug drops it from the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderPanel({ onSave });
  fireEvent.click(screen.getByTitle('Remove stripe'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', [], []));
});

it('adding a new slug appends it to the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderPanel({ onSave });
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'Mercury' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['stripe', 'mercury'], []));
});

it('rejects an invalid slug without saving', async () => {
  const onSave = vi.fn();
  renderPanel({ onSave });
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'bad/slug' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(await screen.findByText(/invalid slug/i)).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

it('flags only broken boards and summarizes health per group after a check', async () => {
  const onCheckHealth = vi.fn().mockResolvedValue({
    results: [
      { key: 'ashby', slug: 'linear', state: 'not_found', found: 0 },
      { key: 'ashby', slug: 'ramp', state: 'ok', found: 8 },
      { key: 'ashby', slug: 'stripe', state: 'ok', found: 2 },
    ],
  } satisfies SourceHealthResponse);
  renderPanel({ onCheckHealth });

  fireEvent.click(screen.getByRole('button', { name: /check board health/i }));

  // The one broken board gets a marker; the healthy ones do not.
  await waitFor(() => expect(screen.getByTitle(/linear — board not found/i)).toBeInTheDocument());
  expect(screen.queryByTitle(/ramp — /i)).not.toBeInTheDocument();
  // Group header summarizes: 2 healthy, 1 broken, with an explanatory tooltip.
  expect(screen.getByText('2 OK')).toBeInTheDocument();
  expect(screen.getByText(/1 unreachable/)).toBeInTheDocument();
  expect(screen.getByTitle(/2 reachable, 1 unreachable/i)).toBeInTheDocument();
});

it('shows an all-clear summary when every board is reachable', async () => {
  const onCheckHealth = vi.fn().mockResolvedValue({
    results: [
      { key: 'ashby', slug: 'linear', state: 'ok', found: 5 },
      { key: 'ashby', slug: 'ramp', state: 'ok', found: 8 },
      { key: 'ashby', slug: 'stripe', state: 'ok', found: 2 },
    ],
  } satisfies SourceHealthResponse);
  renderPanel({ onCheckHealth });

  fireEvent.click(screen.getByRole('button', { name: /check board health/i }));

  await waitFor(() => expect(screen.getByText('✓ 3 reachable')).toBeInTheDocument());
  expect(screen.queryByText(/unreachable/)).not.toBeInTheDocument();
});
