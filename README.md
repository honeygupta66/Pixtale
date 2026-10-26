# Pixtale

> **Turn Images into Meaningful Stories with AI**  
> Full-stack AI creative studio powered by Google Gemini, Node.js + Express, and Supabase.

---

## ✨ Features

- **Split Studio Create Page**:
  - **Image Captioning**: Upload an image once and generate tailored captions across 4 styles (*Normal*, *Creative*, *Short*, *Professional*).
  - **3 Caption Variants**: Generate three distinct caption ideas in a single Gemini call; pick and save the best.
  - **Turn into Story**: Seamlessly convert any generated caption into a long-form creative prompt with one click.
  - **Text & Story Generation**: Produce high-quality content across 4 formats (*Story*, *Blog Post*, *Social Media*, *Product Description*) with customizable tone and length.
  - **Hashtag Generator**: Extract 8–10 relevant, trending hashtags for social posts.
  - **Multi-Language Translation**: Translate captions and stories into **Hindi**, **English**, **Spanish**, and **French**.
- **Dual-Model Sentiment Analysis**:
  - Compare rule-based **VADER Lexicon** vs. **Google Gemini LLM** side-by-side.
  - Normalized score bars ($-1.0$ to $+1.0$), color-coded badges, detected emotions chips, reasoning statements, and model agreement indicators.
- **Image Mood Analysis**:
  - Detect atmosphere, energy levels (*low*, *medium*, *high*), and suggested writing tones (*Adventurous*, *Friendly*, *Professional*, *Funny*, *Dramatic*).
  - Includes a one-click **"Use this tone in Create"** workflow.
- **Public Share Links (`/s/:id`)**:
  - Generate clean, public share links for any creation.
  - Fully responsive, server-rendered read-only view with strict HTML escaping against XSS.
  - Toggle privacy back to private anytime with instant 404 enforcement.
- **Real Authentication & Cloud Database (Supabase)**:
  - Email and password authentication with confirmation checks and persistent/session login options.
  - PostgreSQL storage backed by Row Level Security (RLS) guaranteeing user isolation.
  - Graceful Demo mode fallback when running locally without cloud credentials.
  - One-time migration tool to import legacy local storage items to cloud history.
- **Dynamic Dashboard**:
  - Real-time generation statistics (captions, stories, sentiment analyses).
  - Lightweight, zero-dependency SVG mood distribution donut chart.
- **Mobile Responsive**:
  - Fully optimized for desktop and mobile viewport widths down to 390px.

---

## 📸 Screenshots

| Login & Authentication | Studio Create Workspace |
|:---:|:---:|
| Warm cream & alcove branding theme with email authentication | Split-screen workspace: single image upload with synchronized Caption and Text tabs |

| Dual-Model Sentiment Analysis | Interactive History & Public Share |
|:---:|:---:|
| Side-by-side comparison: VADER lexicon vs Gemini reasoning with emotion chips | Cloud-synced creations with favorite toggles, filters, and public share links |

---

## ⚙️ Environment Variables

Configure the following variables in your `.env` file:

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | **Yes** | — | Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model identifier used for multimodal generation and sentiment analysis. |
| `PORT` | No | `3000` | Port for the Express backend server. |
| `SUPABASE_URL` | Optional | — | Supabase project URL (e.g. `https://xyz.supabase.co`). |
| `SUPABASE_ANON_KEY` | Optional | — | Public Supabase anonymous client API key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | — | Backend Supabase service role key (never sent to client). |

> 🔒 **Security Notice:** The backend only exposes `SUPABASE_URL` and `SUPABASE_ANON_KEY` via `/api/config`. The `SUPABASE_SERVICE_ROLE_KEY` is strictly confined to the backend server and never sent to browser clients.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18.x or v20.x recommended)
- **npm** (v9.x or later)

### 2. Clone and Install Dependencies

```bash
git clone https://github.com/honeygupta66/Pixtale.git
cd Pixtale
npm ci
```

### 3. Configure Environment

Copy `.env.example` to `.env`:

```bash
# On Windows
copy .env.example .env

# On macOS / Linux
cp .env.example .env
```

Open `.env` and enter your `GEMINI_API_KEY`.

### 4. Supabase Database Setup (Optional for cloud sync)

If you wish to use cloud persistence and multi-user authentication:
1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard.
3. Paste and run the contents of [`supabase/schema.sql`](supabase/schema.sql).
4. In **Authentication &rarr; Providers &rarr; Email**, toggle off "Confirm email" for testing.
5. Copy your project credentials to `.env`.

> *Note: If Supabase keys are omitted, Pixtale runs in **Demo Mode** with local in-memory storage and instant login.*

### 5. Start the Application

```bash
npm start
```

Open your browser and navigate to:
**[http://localhost:3000](http://localhost:3000)**

*(Important: Open via `http://localhost:3000`, not by opening `index.html` as a local `file://`)*.

---

## 🔌 API Routes Reference

All `/api/*` endpoints (except `/health` and `/api/config`) are rate-limited (20 requests/min/IP) and protected by `requireUser` authentication.

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | Health check returning `{ ok: true }`. |
| `GET` | `/api/config` | No | Returns public Supabase client configuration (URL & anon key). |
| `GET` | `/s/:id` | No | Public read-only page for shared creations (sanitized HTML). |
| `POST` | `/api/caption` | Yes | Generates a single caption for an uploaded image. |
| `POST` | `/api/caption-variants` | Yes | Generates 3 distinct caption options for an uploaded image. |
| `POST` | `/api/text` | Yes | Generates long-form text (stories, blog posts, marketing copies). |
| `POST` | `/api/sentiment` | Yes | Evaluates text using VADER lexicon and Gemini LLM. |
| `POST` | `/api/image-mood` | Yes | Detects mood, energy, and suggested tone from an image. |
| `POST` | `/api/hashtags` | Yes | Generates 8–10 contextual social hashtags. |
| `POST` | `/api/translate` | Yes | Translates text into Hindi, English, Spanish, or French. |
| `GET` | `/api/items` | Yes | Fetches user's history with filter queries (`kind`, `mood`, `fav`, `q`). |
| `POST` | `/api/items` | Yes | Creates a new history item. |
| `PATCH`| `/api/items/:id` | Yes | Updates favorite status or public visibility toggle. |
| `DELETE`| `/api/items/:id` | Yes | Deletes an item from history. |

---

## 🧪 Testing

Pixtale includes unit and integration tests using **Vitest** and **Supertest**, verifying input validation, token verification (401 responses), sentiment label mapping, and XSS sanitization:

```bash
npm test
```

---

## 🐳 Docker Deployment

You can build and containerize Pixtale using Docker:

```bash
# Build Docker image
docker build -t pixtale .

# Run container
docker run -p 3000:3000 --env-file .env pixtale
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
