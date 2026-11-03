# Applied AI Project Lab

One university project workspace with three independent AI tools behind one landing page:

1. **AI CV Checker** reviews a PDF or text CV, returns an assessment score, and gives document-based suggestions.
2. **AI Roadmap Generator** turns a goal, time period, available hours, and constraints into milestones and tasks.
3. **SiteSense AI** audits a public website using real HTML analysis, Google PageSpeed Insights, Gemini recommendations, and PostgreSQL scan history.

The project selector is the root page (`/`). Each tool has its own route and API endpoint while sharing one React app, Express API, Gemini configuration, repository, and Vercel deployment.

## Requirements and local setup

- Node.js 20–24
- pnpm 11.13.1
- PostgreSQL (Neon works) for saved SiteSense scans
- Gemini API key for all three AI tools
- PageSpeed Insights API key for SiteSense (recommended)

Create one root `.env` from `.env.example`. Set `GEMINI_API_KEY` and `GEMINI_MODEL` for the CV checker, roadmap generator, and SiteSense recommendations. Set `DATABASE_URL` and `DIRECT_URL` for SiteSense scan storage, plus `PAGESPEED_API_KEY` for full Lighthouse results. The server also reads `server/.env` as a local fallback for compatibility.

```sh
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

Open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api` to the Express server on port 4000. The root page links to each tool. SiteSense remains available at `/sitesense`; its dashboard, scanner, history, settings, and reports keep their existing routes.

To build the frontend, run `pnpm build`. To run the server tests, run `pnpm --filter @sitesense/server test`.

## Deploy as one Vercel project

The repository root is the Vercel project root. `vercel.json` builds the React app to `public/` and deploys the root Express entry point as a Node.js Function. Tool pages and same-origin `/api` requests share the same deployment. Import this repository into Vercel with the Root Directory set to the directory containing this README and `vercel.json`; no separate frontend project is needed.

Set these server-side Environment Variables in the Vercel project:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (for example, `gemini-3.8-flash`)
- `PAGESPEED_API_KEY`
- `DATABASE_URL` and `DIRECT_URL` (Neon pooled and direct connection URLs)

`PORT` and `CLIENT_ORIGIN` are local development settings; Vercel does not need them. There is no public `VITE_API_URL`. After configuring environment variables, deploy. Apply the Prisma schema to Neon once with `pnpm db:push` before using SiteSense history. CV documents and generated roadmaps are request-only and are not stored by this application; SiteSense scans are stored in PostgreSQL.

The CV checker accepts PDF files up to 2.8 MB and `.txt` files up to 100 KB. PDF bytes are sent inline to Gemini. Vercel's function request body limit is 4.5 MB, so the CV upload cap leaves room for base64 and JSON overhead. Google API quotas and Vercel function duration still apply.

## Features and routes

| Tool | Page | API | Data handling |
| --- | --- | --- | --- |
| AI CV Checker | `/cv-checker` | `POST /api/cv/analyze` | Analyzes one PDF or TXT per request; no CV is persisted |
| AI Roadmap Generator | `/roadmap-generator` | `POST /api/roadmap/generate` | Generates a plan from supplied goal and context; no plan is persisted |
| SiteSense AI | `/sitesense`, `/dashboard`, `/scan`, `/history`, `/reports/:id` | `/api/scan`, `/api/scans` | Performs real website checks and saves reports through Prisma/PostgreSQL |

Shared API routes include `GET /api/health`, `GET /api/scans`, and `GET /api/scans/:id`.

### AI CV Checker

- Accepts PDF or text CV content, with an optional target role.
- Uses the official `@google/genai` SDK and the server-side `GEMINI_API_KEY` / `GEMINI_MODEL` values.
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
- Sends actual audit findings and PageSpeed data to Gemini. Recommendations are checked against evidence before being saved.
- Saves website scan results, technical findings, and AI recommendations through Prisma.

## Tests

The server suite covers URL safety, HTML parsing, PageSpeed mapping, Gemini evidence checks, CV upload/schema validation, roadmap schema validation, and scan persistence orchestration:

```sh
pnpm --filter @sitesense/server test
```

AI-tool tests stub the Gemini SDK to verify request construction and error handling without consuming API quota. A live website scan requires outbound network access, configured Google keys, and Neon configuration to verify persistence against the database.

## Security and limitations

- Keep `.env` out of version control. API keys stay on the server and are not included in the frontend bundle.
- CV file contents are sent to Google Gemini for analysis. The app does not write CV documents or roadmaps to its database.
- SiteSense does not include user accounts; anyone with the deployment URL can use its public endpoints. Per-route in-memory limits reduce accidental bursts but are not a distributed abuse-prevention system.
- Vercel function duration, payload limits, and Google API quotas apply to requests.
