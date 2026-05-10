# Candidate brief

This file is the candidate description that `pnpm run ai-review` sends to the
LLM when it judges each posting. Keep it short and specific — 6–10 lines is
plenty. It's used to decide whether the LLM agrees with the rule-based fit
score, so **what's not a fit** is just as useful as what is.

The fastest way to fill this in is **`pnpm run setup-brief --file path/to/cv.pdf`**
or open the local UI (`pnpm run ui`) and use the Profile tab to paste / drop
your CV. Either flow runs your CV through the LLM CLI and rewrites the body
of this file. You can also hand-edit below the marker.

<!-- candidate-brief:start -->

> **Replace this block with your own description.**
>
> Three short paragraphs work well:
>
> 1. Who you are: role, years of experience, primary location, primary stack.
> 2. What you're looking for: target seniority (senior/lead/staff/principal),
>    sectors (web3 / AI / fintech / healthtech / etc.), location preference
>    (remote-worldwide / remote-EMEA / hybrid in `<city>` / open to relocation).
> 3. What to avoid: roles that look like a fit on paper but aren't (e.g. "I'm
>    a backend engineer, skip frontend-leaning postings", or "no on-site, no
>    US-only, no junior").

<!-- candidate-brief:end -->
