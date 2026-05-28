import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from './Onboarding.tsx';
import type { Provider } from './settings/types.ts';

const NONE_INSTALLED: Record<Provider, boolean> = {
  claude: false,
  codex: false,
  gemini: false,
  opencode: false,
};

// Route every /api/llm-detect probe through `getAvailable`, which is read
// fresh per call so a test can flip availability between probes (Re-check).
function mockDetect(getAvailable: () => Record<Provider, boolean>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/llm-detect')) {
      return new Response(JSON.stringify({ available: getAvailable() }), { status: 200 });
    }
    return new Response('not mocked', { status: 500 });
  }) as typeof fetch;
}

function downloadLinks(): HTMLAnchorElement[] {
  return screen.queryAllByRole('link', { name: /download/i }) as HTMLAnchorElement[];
}

describe('Onboarding — provider step', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disambiguates the Claude CLI from the desktop app', async () => {
    mockDetect(() => NONE_INSTALLED);
    render(<Onboarding onComplete={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Auto-detect')).toBeInTheDocument());

    expect(screen.getByText(/command-line tools/i)).toBeInTheDocument();
    expect(screen.getByText(/Claude desktop app/i)).toBeInTheDocument();
  });

  it('offers a Download link aimed at the right CLI docs for each provider', async () => {
    mockDetect(() => NONE_INSTALLED);
    render(<Onboarding onComplete={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Auto-detect')).toBeInTheDocument());

    const hrefs = downloadLinks().map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://code.claude.com/docs/en/quickstart',
      'https://github.com/openai/codex',
      'https://github.com/google-gemini/gemini-cli',
      'https://opencode.ai/docs/',
    ]);
    // Links open safely in a new tab.
    for (const a of downloadLinks()) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('hides the Download link once a provider is installed', async () => {
    mockDetect(() => ({ ...NONE_INSTALLED, claude: true }));
    render(<Onboarding onComplete={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Auto-detect')).toBeInTheDocument());

    // claude installed → its radio is selectable and it carries no Download link.
    expect(screen.getByRole('radio', { name: /claude code/i })).toBeEnabled();
    expect(downloadLinks()).toHaveLength(3);
    expect(downloadLinks().map((a) => a.getAttribute('href'))).not.toContain(
      'https://code.claude.com/docs/en/quickstart',
    );
  });

  it('re-probes detection when Re-check is clicked', async () => {
    let claudeInstalled = false;
    mockDetect(() => ({ ...NONE_INSTALLED, claude: claudeInstalled }));
    render(<Onboarding onComplete={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Auto-detect')).toBeInTheDocument());
    expect(downloadLinks()).toHaveLength(4);

    // User installs Claude Code in another terminal, then hits Re-check.
    claudeInstalled = true;
    fireEvent.click(screen.getByRole('button', { name: /re-check/i }));

    await waitFor(() => expect(downloadLinks()).toHaveLength(3));
    expect(screen.getByRole('radio', { name: /claude code/i })).toBeEnabled();
  });
});
