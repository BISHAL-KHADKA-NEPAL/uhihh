# Form Persona Tool - Documentation

This document describes the complete architecture, concepts, and database schema for new developers joining the project.

## Architecture Overview

The application is a Full-Stack React Application built with Vite and an Express backend server.

- **Frontend:** React 19, Tailwind CSS (v4), Lucide React (for icons), and Motion (for animations).
- **Backend:** Express server (`server.ts`) that runs alongside the Vite dev server (in development) and serves static files (in production).
- **Authentication & Database:** Supabase (`@supabase/supabase-js`, `@supabase/auth-ui-react`).
- **AI Integration:** Google Gemini API (`@google/genai`) for generating personas based on the form's structural context.

## How It Works

1. **URL Submission & HTML Scraping:** 
   The user submits a Google Form URL. The frontend calls an external API (`https://opkl.vercel.app/api/fetch-html`) to fetch and parse the Google Form's raw HTML structure, extracting the questions, sections, types, options, and entry IDs.
   
2. **Database Storage (Forms):**
   When a form is fetched successfully, a record is saved to the `submitted_urls` table in Supabase, keeping track of what forms the user is processing.

3. **AI Persona Generation:**
   The user requests a specific number of personas. The frontend sends the structured questions to the Express backend (`/api/generate-personas`). The backend uses the `gemini-2.5-flash` model with a strict JSON schema prompt to generate realistic personas. These personas include demographic data, pain points, and specific string answers mapping to the Google Form's `entryId`s. Irregularities (like typos or Nepali/Nepanglish answers) are dynamically introduced to make the answers look authentic.

4. **Database Storage (Personas):**
   The generated personas are stored in the `personas` table in Supabase, linked to the user and the specific form they were generated for.

5. **Prefilled URL Generation:**
   The user selects which personas they want to generate links for. The application iterates over the selected personas and constructs Google Form prefilled URLs by appending `&entry.[id]=[answer]` query parameters to the base form URL.

6. **Database Storage (Generated URLs):**
   The final generated URLs are saved in the `generated_urls` table, linked to the user and the specific form.

## Database Schema (Supabase)

The database follows a relational design. Instead of creating a new table for every URL (which is an anti-pattern), all data is stored in unified tables and separated by `user_id` and `form_id` relationships.

To set up the Supabase database, run the following SQL commands in your Supabase SQL Editor:

```sql
-- 1. Create the submitted_urls table
CREATE TABLE submitted_urls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE submitted_urls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own urls" ON submitted_urls FOR ALL USING (auth.uid() = user_id);


-- 2. Create the personas table
CREATE TABLE personas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  form_id UUID REFERENCES submitted_urls(id) ON DELETE CASCADE,
  name TEXT,
  archetype TEXT,
  demographics JSONB,
  behaviors TEXT,
  mindset TEXT,
  pain_points TEXT,
  answers JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own personas" ON personas FOR ALL USING (auth.uid() = user_id);


-- 3. Create the generated_urls table
CREATE TABLE generated_urls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  form_id UUID REFERENCES submitted_urls(id) ON DELETE CASCADE,
  generated_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE generated_urls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own generated urls" ON generated_urls FOR ALL USING (auth.uid() = user_id);
```

## Running the Application

1. Provide the following variables to your environment:
   - `GEMINI_API_KEY`: Your Gemini API key for generating personas.
   - `VITE_SUPABASE_URL`: Your Supabase Project URL.
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon/Publishable Key.
2. In Development: The server automatically runs via `tsx server.ts` starting both Express and Vite.
3. In Production: Run `npm run build` followed by `npm run start`.
Note: The user requested email and password only, and no OTP. Therefore, you MUST disable 'Confirm email' in your Supabase project's Authentication Providers settings (under Email provider) to allow immediate sign in after sign up.
