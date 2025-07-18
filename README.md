
# QuantumMind AI 🤖💬

Welcome to the **QuantumMind AI** project! This repository hosts a powerful FastAPI-based backend for an AI chatbot, designed to provide intelligent conversational capabilities with the added benefit of document understanding and persistent chat history.

---

## ✨ Features

- **FastAPI Backend**: High performance, asynchronous operations, and easy API development 🚀
- **Real-time Chat Streaming**: Stream AI responses chunk by chunk ⚡
- **PDF Upload & Context Injection (RAG-like)**: Upload PDFs, and the chatbot can use their content to answer questions 📄➡️🧠
- **Temporary PDF Storage**: PDFs stored in RAM during active sessions (lost on restart) 💾
- **Persistent Chat History**: Stored in SQLite, allowing you to resume conversations 📚
- **Comprehensive Session Management**: Create, retrieve, and delete sessions easily 🔄
- **OpenRouter Integration**: Uses `deepseek` for conversational capabilities 🌐
- **CORS Enabled**: Ready for frontend integrations 🔗
- **Robust Error Handling**: For stable PDF processing and API calls 🛡️

---

## 🛠️ Technologies Used

- **Backend Framework**: FastAPI
- **PDF Processing**: PyPDF2
- **HTTP Client**: httpx
- **Environment Variables**: python-dotenv
- **Database**: SQLite3
- **AI API**: OpenRouter

---

## 🚀 Setup & Installation

Follow these steps to get your QuantumMind AI backend up and running locally.

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/Vishalvk2219/Inzint-AI_Chatbot.git
cd Inzint-AI_Chatbot
```

### 2️⃣ Create and Activate a Virtual Environment

It is recommended to isolate dependencies:

```bash
# Create virtual environment
python -m venv newenv

# Activate:
# On Windows:
newenv\Scripts\activate

# On macOS/Linux:
source newenv/bin/activate
```

### 3️⃣ Install Dependencies

```bash
pip install fastapi uvicorn python-dotenv pydantic PyPDF2 httpx
# OR, if you have requirements.txt:
pip install -r requirements.txt
```

### 4️⃣ Configure Environment Variables

Create a `.env` file in your project root:

```
DEEP="YOUR_OPENROUTER_API_KEY"
```

⚠️ Replace with your actual OpenRouter API key.  
⚠️ Do **not** commit `.env` to version control.

### 5️⃣ Run the FastAPI Application

```bash
python app.py
```
or
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will now be accessible at: [http://0.0.0.0:8000](http://0.0.0.0:8000) 🎉

---

## 🚀 Frontend

For Frontend view you can:

- Navigate to your frontend folder.
- Install dependencies:

```bash
npm install
```

- Run the frontend development server:

```bash
npm start
```

Ensure your frontend `.env` is configured to connect to `http://localhost:8000` for local API calls.

---

## 🎯 API Endpoints

### Health Check

`GET /health`

Checks server and database status.

**Example Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-07-18T16:25:00.000000",
  "database_status": "connected",
  "pdf_cache_size": 0,
  "pdf_cache_note": "PDFs are stored temporarily in memory and are lost on server restart.",
  "embedding_model_status": "N/A (RAG and embedding model not used)"
}
```

---

### Root Endpoint

`GET /`

Simple confirmation endpoint.

**Example Response:**

```json
{
  "message": "AI Chatbot API is running with temporary PDF memory and SQLite (History)!"
}
```

---

### PDF Management

#### Upload PDF

`POST /upload-pdf`

Uploads and extracts PDF text, storing it temporarily in RAM.

**Example cURL:**

```bash
curl -X POST "http://localhost:8000/upload-pdf" \
     -H "accept: application/json" \
     -H "Content-Type: multipart/form-data" \
     -F "file=@/path/to/your/document.pdf;type=application/pdf"
```

---

#### List Uploaded PDFs

`GET /pdfs`

Lists PDFs in memory.

**Example cURL:**

```bash
curl -X GET "http://localhost:8000/pdfs" -H "accept: application/json"
```

---

### Chat Session Management

#### Get All Sessions

`GET /sessions`

#### Get Session History

`GET /sessions/{session_id}`

#### Delete a Session

`DELETE /sessions/{session_id}`

---

### Chat Interaction (Streaming)

`POST /chat-stream`

Initiates a streaming chat conversation with optional PDF context.

---

## ⚠️ Important Notes

- **Temporary PDF Storage**: Data is lost on restart; use persistent storage for production.
- **Token Limits**: Uses `MAX_HISTORY_TOKENS = 2000` and `MAX_PDF_TOKENS = 4000`.
- **OpenRouter API Key**: Required for chat.
- **SQLite for History**: Suitable for small/medium projects; use PostgreSQL for scale.

---

## 📬 License and Contributions

Fork, improve, and submit PRs.  
For issues, use GitHub Issues.

---

🚀 **Enjoy building your intelligent, document-aware AI chatbot with QuantumMind AI!**
