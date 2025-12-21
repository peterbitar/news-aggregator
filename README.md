# 📰 News Aggregator

A modern and responsive news aggregator web app that fetches and displays news articles based on categories and search terms.

## 🚀 Live Demo
🔗 [News Aggregator - Live Website](https://news-aggregator-fe.onrender.com)  
🔗 [Backend API - Render](https://news-aggregator-fea2.onrender.com/api/news?category=technology)

<img width="1491" alt="image" src="https://github.com/user-attachments/assets/ffbfcc1b-07df-4be1-952a-a2dbd303c72b" />

Loading State

<img width="1485" alt="image" src="https://github.com/user-attachments/assets/5ac3b72d-f174-496a-b99e-e7b5c2d091cc" />


Search

<img width="1475" alt="image" src="https://github.com/user-attachments/assets/6fafaf44-0250-4731-bc31-f493482f16c8" />



---

## 🛠️ Tech Stack

- **Frontend:** React, TypeScript, Styled Components, React Query
- **Backend:** Node.js, Express, Axios
- **Deployment:** Render (Backend , Frontend)
- **API:** [NewsAPI.org](https://newsapi.org/) (for fetching news data)

---

## 📥 Installation Guide

### **1️⃣ Clone the Repository**
```sh
git clone https://github.com/sogolnaseri/news-aggregator.git
cd news-aggregator

```
### **2️⃣ Install Dependencies**
Run this inside both the frontend and backend folders:
```sh
npm install
```

### **3️⃣ Set Up Environment Variables**
Create a `.env` file in the backend directory and add:
```sh
NEWS_API_KEY=your-newsapi-key
GNEWS_API_KEY=your-gnews-key (optional)
OPENAI_API_KEY=your-openai-key (required for LLM processing)
INTERNAL_API_KEY=your-secret-internal-key (required for /internal endpoints)
DISABLE_SCHEDULER=false (set to "true" to disable automated processing)
```
For the frontend, create a `.env` file in the root directory and add:
```sh
REACT_APP_BACKEND_URL=http://localhost:5001
```

### **4️⃣ Start the Backend**
Navigate to the backend folder and start the server:
```sh
cd backend
npm start
```
This will start the backend at http://localhost:5001.

### **5️⃣ Start the Frontend**
Navigate to the `news-aggregator` project for frontend and start the React app
```sh
npm start
```

---
## API Endpoints

### iOS App Endpoints (v1)
**IMPORTANT: iOS app must ONLY use /v1 endpoints. Never call /api or /internal endpoints.**

| Method  | Endpoint | Description |
| --- | ---- | ----|
| GET | /v1/feed?limit=20 | Get personalized feed (Signal DTO format) |
| POST | /v1/interpret | Interpret text/URL and return Signal |
| PUT | /v1/preferences | Update user preferences (profile, holdings) |
| GET | /v1/brief/latest | Get daily brief (stub in MVP) |

**Headers required:**
- `x-user-id`: User ID (defaults to 1 if not provided)

**Rate limiting:** 100 requests per minute per user

### Admin/Internal Endpoints
**PROTECTED: Requires `x-internal-key` header matching `INTERNAL_API_KEY` env var.**

| Method  | Endpoint | Description |
| --- | ---- | ----|
| POST | /internal/ingest | Ingest news articles from APIs |
| POST | /internal/process | Process articles through pipeline (stages 1-4) |
| POST | /internal/rank | Run ranking and clustering (stage 5) |
| GET | /internal/health | Health check with counts |

### Legacy Admin UI Endpoints
| Method  | Endpoint | Description |
| --- | ---- | ----|
| GET | /api/news?category=technology |  Fetch news articles by category (cached only, scraping requires internal key) |
| GET | /api/news?search=apple  | Fetch news articles by search term |
| GET | /api/holdings | Get user holdings |
| POST | /api/holdings | Create holding |
| DELETE | /api/holdings/:id | Delete holding |

---
## Deployment
### Backend
- Hosted on [Render](https://render.com/).
- Uses Express.js for handling API requests.

### Frontend
- Hosted on [Render](https://render.com/).
- Built with React + React Query for data fetching.
