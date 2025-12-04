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

### **3️⃣ Set Up Environment Variables**
Create a `.env` file in the backend directory and add:
```sh
NEWS_API_KEY=your-newsapi-key
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
| Method  | Endpoint | Description |
| --- | ---- | ----|
| GET | /api/news?category=technology |  Fetch news articles by category |
| GET | /api/news?search=apple  | Fetch news articles by search term |

---
## Deployment
### Backend
- Hosted on [Render](https://render.com/).
- Uses Express.js for handling API requests.

### Frontend
- Hosted on [Render](https://render.com/).
- Built with React + React Query for data fetching.
