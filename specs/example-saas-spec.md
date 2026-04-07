---
domain: saas
phase: mvp
riskProfile: prototype
customKeywords:
  - auth
  - onboarding
  - payments
  - dashboard
---

# Next.js SaaS Platform

Build a modern Next.js SaaS application with authentication, user dashboard, Stripe payments, and an onboarding flow.

## Core Requirements

- User authentication with social login (Google, GitHub)
- Role-based access control (admin, user)
- Responsive dashboard with analytics widgets
- Stripe integration for subscriptions and one-time payments
- Multi-step onboarding flow with progress indicator
- Team/workspace management

## Tech Stack

- Next.js 15 App Router with TypeScript
- Tailwind CSS + shadcn/ui
- Prisma ORM with PostgreSQL
- NextAuth.js for authentication
- Stripe SDK for payments

## UX Goals

- Conversion-optimized onboarding (< 3 steps to value)
- Mobile-first responsive design
- Accessible (WCAG 2.1 AA)
- Fast initial load (< 2s LCP)
