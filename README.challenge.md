The Candidate Challenge (README.md)

# Full Stack Challenge: Medical Provider Verifier

## 1. The Mission

Build a Full Stack application that allows an admin to verify the legal status and location of healthcare providers by scraping **OpenCorporates**.

## 2. The Scenario

The organization needs to ensure that medical clinics and systems are legally registered and active.

- **Target Website:** [OpenCorporates Search](https://opencorporates.com/companies)
- **Goal:** Given a company name (e.g., "Mayo Health System"), your app must scrape the provider's legal details, validate them using AI, and store them.

## 3. Functional Requirements

### A. Data Ingestion (Backend)

- **Scraper:** Create a service (Playwright/Puppeteer/Cheerio) that navigates to OpenCorporates, searches by company name, and extracts:
- `Company Name`
- `Status` (e.g., Inactive, Active)
- `Jurisdiction`
- `Head Office Address`(e.g., 1602 FOUNTAIN ST, ALBERT LEA, MN, 56007, USA)
- **AI Validation Layer:** Pass the scraped text to an LLM (OpenAI/Anthropic or a robust Mock). The AI must:
- **Standardize the Address:** Format it correctly (Proper Case, Zip Code validation).
- **Risk Assessment:** Flag the provider if the `Status` is "Inactive".
- **Data Enrichment:** Based on the name, categorize the provider (e.g., "Clinic", "Health System", "Non-profit").

### B. Provider Dashboard (Frontend)

The React dashboard must include:

1. **Search Bar:** Input field for the company name and a "Verify" button.
2. **Real-time Status Tracker:** Since scraping + AI takes time, show a step-by-step progress indicator:

- `[ ] Searching OpenCorporates...`
- `[ ] Analyzing Legal Status with AI...`
- `[ ] Saving to Database...`

3. **Results Table:** A list of all verified providers showing:

- Name, Jurisdiction, Status, and a "Risk Level" badge (e.g.,`High Risk` if Inactive, `Verified` if Active).

4. **Detail View:** Clicking a provider shows:

- Full cleaned data and the raw HTML snippet for audit purposes.

## 4. Architectural Requirements

To align with our production standards, the solution **must** adhere to the following:

- **Asynchronous Processing:** The `POST /verify` endpoint must return an immediate `202 Accepted` with a `jobId`. The frontend must handle the lifecycle via polling or WebSockets.
- **Type Safety:** Implement **Strict TypeScript** across the entire stack.
- **Testing Strategy:** Implement at least:
- **Unit Tests:** For the core business logic (e.g. AI validation rules, data cleaning).
- **Cloud-Native Design (IaC):** Define all infrastructure (Lambda, S3, DynamoDB) using **Infrastructure as Code** (Serverless Framework, AWS SAM, or CDK).
- **Resilience:** Implement robust error handling and retry strategies for both the scraper and AI service calls.

## 5. Local Development & Simulation

- **No Cloud Costs:** You are **not** required to deploy to a live AWS account.
- **Environment:** Use **Docker Compose** and/or **LocalStack** to simulate AWS services (S3, DynamoDB) locally.
- **Setup:** Provide a clear guide or a `docker-compose.yml` to spin up the full environment.

## 6. Deliverables

- **Source Code:** Access to a private repository.
- **ARCHITECTURE.md:** A document explaining your design choices, how you handled asynchrony, and your plan to scale
  this to 10,000 requests per hour.
- **Setup Guide:** Instructions to run the project locally.

---
*We value clean code, performance, and attention to detail.