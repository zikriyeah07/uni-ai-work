# Applied AI Project Lab

One university project workspace with three independent AI tools behind one landing page:

1. **AI CV Checker** reviews a PDF or text CV, returns an assessment score, and gives document-based suggestions.
2. **AI Roadmap Generator** turns a goal, time period, available hours, and constraints into milestones and tasks.
3. **SiteSense AI** audits a public website using real HTML analysis, Google PageSpeed Insights, and Gemini or OpenRouter recommendations.

The project selector is the root page (`/`). Each tool has its own route and API endpoint while sharing one React app, Express API, Gemini and OpenRouter providers, repository, and Vercel deployment.

## Requirements and local setup

- Node.js 20–24
- pnpm 11.13.1
- An OpenRouter API key, a Gemini API key, or both for all three AI tools
- PageSpeed Insights API key for SiteSense (recommended)

Create one root `.env` from `.env.example`. Set `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, or both. The default `AI_PROVIDER_ORDER="openrouter,gemini"` tries OpenRouter first, retries a cut-off SiteSense response with a smaller request, then falls back to Gemini if OpenRouter hits a limit, times out, or returns an invalid response. Change it to `gemini,openrouter` to reverse the order. At least one provider key is required; both keys are needed for failover. OpenRouter defaults to `OPENROUTER_MODEL=openrouter/free`; optional overrides must end in `:free`, and paid model IDs are rejected. Gemini defaults to `GEMINI_MODEL=gemini-3.5-flash-lite`. Set `PAGESPEED_API_KEY` for full Lighthouse results. The server also reads `server/.env` as a local fallback for compatibility.

```sh
pnpm install
pnpm dev
```

Open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api` to the Express server on port 4000. The root page links to each tool. SiteSense remains available at `/sitesense`; its dashboard, scanner, session reports, settings, and report pages keep their existing routes.

To build the frontend, run `pnpm build`. To run the server tests, run `pnpm --filter @sitesense/server test`.

## Deploy as one Vercel project

The repository root is the Vercel project root. `vercel.json` builds the React app to `public/` and deploys the root Express entry point as a Node.js Function. Tool pages and same-origin `/api` requests share the same deployment. Import this repository into Vercel with the Root Directory set to the directory containing this README and `vercel.json`; no separate frontend project is needed.

Set these server-side Environment Variables in the Vercel project:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (defaults to `openrouter/free`; optional free model IDs must end in `:free`)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (defaults to `gemini-3.5-flash-lite`)
- `AI_PROVIDER_ORDER` (defaults to `openrouter,gemini`; reverse to `gemini,openrouter`)
- `PAGESPEED_API_KEY`

`PORT` and `CLIENT_ORIGIN` are local development settings; Vercel does not need them. There is no public `VITE_API_URL`. CV documents and generated roadmaps are request-only. SiteSense returns scan reports through its API and keeps up to 50 reports in the current browser session; reports clear when that session ends.

The CV checker accepts PDF files up to 2.8 MB and `.txt` files up to 100 KB. Gemini reads PDFs directly; OpenRouter uses its Cloudflare text extraction plugin. Scanned PDFs may still fail to produce readable text. Vercel's function request body limit is 4.5 MB, so the CV upload cap leaves room for base64 and JSON overhead. Free provider tiers have shared usage limits, and Vercel function duration also applies.

## Features and routes

| Tool | Page | API | Data handling |
| --- | --- | --- | --- |
| AI CV Checker | `/cv-checker` | `POST /api/cv/analyze` | Analyzes one PDF or TXT per request; no CV is persisted |
| AI Roadmap Generator | `/roadmap-generator` | `POST /api/roadmap/generate` | Generates a plan from supplied goal and context; no plan is persisted |
| SiteSense AI | `/sitesense`, `/dashboard`, `/scan`, `/history`, `/reports/:id` | `POST /api/scan` | Performs real website checks and returns reports to the browser session |

Shared API route: `GET /api/health`.

### AI CV Checker

- Accepts PDF or text CV content, with an optional target role.
- Tries the configured AI providers in order and falls back automatically when one is unavailable. Both Gemini and OpenRouter use structured output validation.
- Requests a structured score, summary, strengths, evidence-based improvements, and next steps.
- Validates the score, response shape, priorities, and text-file evidence. The model is instructed not to invent qualifications, metrics, or achievements.
- Handles missing API keys, quota limits, timeouts, and invalid model responses with readable errors.

### AI Roadmap Generator

- Collects a goal, duration (1–36 months), hours per week, starting stage, background, and constraints.
- Returns a structured timeline with ordered milestones, tasks, deliverables, weekly rhythm, and success checks.
- Validates duration, milestone order, response shape, and text lengths before returning it to the browser.
- Supports copying or downloading the generated plan as Markdown.

### SiteSense AI

- Validates public URLs and blocks private/reserved network destinations and unsafe redirects.
- Fetches and parses HTML with Cheerio; checks SEO metadata, headings, images, internal links, `robots.txt`, and `sitemap.xml`.
- Requests real PageSpeed Insights data for mobile or desktop, including Lighthouse categories and available Core Web Vitals.
- Sends actual audit findings and PageSpeed data to the configured AI providers. Recommendations are checked against evidence before being returned.
- Returns website scan results, technical findings, and AI recommendations directly to the browser.
- Keeps recent reports in browser session storage; no database is required.

## Tests

The server suite covers URL safety, HTML parsing, PageSpeed mapping, AI evidence checks, CV upload/schema validation, roadmap schema validation, and scan orchestration:

```sh
pnpm --filter @sitesense/server test
```

AI-tool tests stub provider requests to verify request construction, fallback, and error handling without consuming model quota. A live website scan requires outbound network access, at least one configured AI key, and a PageSpeed key for full Lighthouse results.

## Security and limitations

- Keep `.env` out of version control. API keys stay on the server and are not included in the frontend bundle.
- CV file contents are sent to the first configured provider and may also be sent to the fallback provider if the first fails. CV documents and roadmaps are not retained after their requests complete. Gemini's free tier may use submitted content to improve Google products; review the provider terms before enabling it for sensitive CVs.
- SiteSense does not include user accounts; anyone with the deployment URL can use its public endpoints. Per-route in-memory limits reduce accidental bursts but are not a distributed abuse-prevention system.
- Vercel function duration, payload limits, and Google API quotas apply to requests.
