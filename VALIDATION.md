# Local validation · October 20, 2026

- 16 Python tests pass, including a mocked wire-level LangChain Responses API contract.
- Python lint passes.
- TypeScript checking and Vite production build pass.
- Browser checks pass for the welcome screen, missing-key setup, guided demo, source library, and page-source switching.
- The double-click launcher's underlying `run.py` starts both local services successfully.
- Docker image builds successfully. The running image returned HTTP 200 for the frontend, health endpoint, guided sample, and original sample PDF. Temporary test container was stopped.
- Vercel frontend configuration is provided; no deployment was requested or performed.
- Live OpenAI verification passed using the fictional Atlas PDF: indexing returned HTTP 201; chat returned HTTP 200 with “The pilot budget is $4,800 [1]” and a supporting passage on page 2. No user documents were used in this check. Automated tests continue to use test doubles; the guided UI demo remains a clearly labeled prepared example.
- Screenshots show the actual local application.
