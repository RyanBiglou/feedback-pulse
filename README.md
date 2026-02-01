# Feedback Pulse
https://feedback-pulse.rbiglou.workers.dev

Feedback Pulse is a lightweight prototype that aggregates recent customer feedback and uses AI to extract actionable product insights.

The goal of the project is to help product managers quickly understand what users are experiencing, what issues are urgent, and where to focus next without manually reading through scattered feedback.

## What It Does
- Collects feedback via a simple API
- Stores entries in Cloudflare D1
- Uses Workers AI to summarize themes, sentiment, and urgency
- Returns structured JSON suitable for dashboards or alerts

## Tech Stack
- JS
- Cloudflare Workers
- D1 Database
- Workers AI

## Endpoints
- POST /feedback
- GET /seed
- GET /summary

## Purpose
Built as a product management prototype to explore feedback aggregation and insight extraction.

## How To Use

To quickly populate the project with mock feedback for demos, visit:
https://feedback-pulse.rbiglou.workers.dev/seed
Then, https://feedback-pulse.rbiglou.workers.dev/summary

This will show the top three themes of user complaints, with a summary, sentiment, urgency, and evidence quote.
