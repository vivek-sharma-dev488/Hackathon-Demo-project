# Meal Pre-Booking System With Food Waste Monitoring

Full-stack web app built with React, Tailwind CSS, Supabase (PostgreSQL + Auth + Realtime), and Recharts.

## Features

- Email/password signup and login (Supabase Auth)
- Role-based UI and data access (`admin`, `user`)
- Meal management (admin)
- Meal pre-booking before deadline (user)
- Portion size selection (`small`, `medium`, `large`)
- Booking history
- Waste logging (admin)
- Realtime dashboard refresh and live booking count updates (Supabase Realtime)
- Analytics dashboard:
	- Booked vs prepared meals
	- Waste trends over time
	- High-waste day highlighting
	- Insight: suggested preparation reduction percentage
- Smart prediction: next meal demand based on previous 7 days bookings

## Tech Stack

- Frontend: React (hooks + functional components)
- Styling: Tailwind CSS
- Charts: Recharts
- Backend: Supabase (PostgreSQL, Auth, Realtime)

## Project Structure

```text
.
|-- .env.example
|-- index.html
|-- package.json
|-- postcss.config.js
|-- tailwind.config.js
|-- vite.config.js
|-- src
|   |-- App.jsx
|   |-- index.css
|   |-- main.jsx
|   `-- lib
|       `-- supabase.js
`-- supabase
		`-- schema.sql
```

## Step-by-Step Setup

1. Install dependencies

```bash
npm install
```

2. Create a Supabase project

- Open Supabase dashboard.
- Create a new project.
- In `Project Settings -> API`, copy:
	- `Project URL`
	- `anon public` key

3. Configure environment

```bash
cp .env.example .env
```

Set values in `.env`:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Run SQL schema and policies

- Open Supabase SQL Editor.
- Paste and run `supabase/schema.sql`.

This creates:
- Tables: `users`, `meals`, `bookings`, `waste_logs`
- Constraints, indexes
- RLS policies
- Helper function `is_admin()`
- Realtime publication enablement for required tables

5. Configure Auth

- In Supabase dashboard: `Authentication -> Providers -> Email` enable email/password.
- Optional: disable email confirmation for easier local testing.

6. Run app

```bash
npm run dev
```

7. Build for production

```bash
npm run build
```

## Role Behavior

- `user`
	- Can view meals.
	- Can create/cancel own bookings before deadline.
	- Can view own booking history.

- `admin`
	- Can create/update/delete meals.
	- Can view all bookings.
	- Can log waste data.
	- Can view analytics and prediction dashboard.

## Waste Monitoring Logic

Formula used in UI and SQL semantics:

```text
waste_percentage = (wasted_quantity / prepared_quantity) * 100
```

`wasted_quantity` is stored and validated with checks to avoid negative values.

## Prediction Logic (Basic)

The app computes demand forecast for the next meal by averaging confirmed bookings over the last 7 days.

```text
predicted_demand = round(sum(last_7_day_bookings) / 7)
```

## Notes

- If you need strict admin assignment, keep signup default role as `user` and promote users to `admin` via SQL manually.
- Current implementation allows role selection at signup to match the requested demo behavior.