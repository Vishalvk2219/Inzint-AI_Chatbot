from fastapi import FastAPI, HTTPException, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, AsyncGenerator, Dict, Any
import PyPDF2
import io
import asyncio 
from datetime import datetime
import uuid
import json
from fastapi.responses import StreamingResponse
import os
import httpx
from dotenv import load_dotenv
import sqlite3

load_dotenv()

app = FastAPI(title="AI Chatbot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENROUTER_API_KEY = os.getenv("DEEP")

if not OPENROUTER_API_KEY:
    raise ValueError("OPENROUTER_API_KEY environment variable not set. Please set it in your .env file.")

temporary_pdf_cache: Dict[str, Dict[str, Any]] = {}

conn = sqlite3.connect("chat_history.db", check_same_thread=False)

def init_db():
    with conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
            )
        """)

init_db()

class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[datetime] = None

class ChatRequest(BaseModel):
    message: str
    session_id: str
    use_pdf: bool = False
    pdf_ids: Optional[List[str]] = []

class SessionResponse(BaseModel):
    session_id: str
    messages: List[ChatMessage]

def extract_text_from_pdf(pdf_file: bytes) -> str:
    try:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_file))
        text = ""
        for page in pdf_reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing PDF: {str(e)}")

async def create_session_in_db(session_id: str):
    def _create():
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR IGNORE INTO sessions (session_id, created_at) VALUES (?, ?)",
                (session_id, datetime.now().isoformat())
            )
    await asyncio.to_thread(_create)

async def get_session_messages_from_db(session_id: str) -> List[ChatMessage]:
    def _get():
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp",
                (session_id,)
            )
            rows = cursor.fetchall()
            messages = []
            for row in rows:
                messages.append(ChatMessage(role=row[0], content=row[1], timestamp=datetime.fromisoformat(row[2])))
            return messages
    return await asyncio.to_thread(_get)

async def add_message_to_session_in_db(session_id: str, message: ChatMessage):
    def _add():
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO messages (message_id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), session_id, message.role, message.content, message.timestamp.isoformat())
            )
    await asyncio.to_thread(_add)

async def delete_session_from_db(session_id: str):
    def _delete():
        with conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    await asyncio.to_thread(_delete)

async def list_sessions_from_db() -> List[str]:
    def _list():
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT session_id FROM sessions")
            rows = cursor.fetchall()
            return [row[0] for row in rows]
    return await asyncio.to_thread(_list)

async def stream_ai_response_from_openrouter(messages: List[dict]) -> AsyncGenerator[str, None]:
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "AI Chatbot"
    }

    payload = {
        "model": "deepseek/deepseek-chat",
        "messages": messages,
        "stream": True
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                "https://openrouter.ai/api/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=60.0
            ) as response:
                response.raise_for_status()
                
                buffer = ""
                async for chunk in response.aiter_bytes():
                    decoded_chunk = chunk.decode('utf-8')
                    buffer += decoded_chunk
                    
                    while "\n\n" in buffer:
                        event_data, buffer = buffer.split("\n\n", 1)
                        lines = event_data.splitlines()
                        
                        json_data = ""
                        for line in lines:
                            if line.startswith("data:"):
                                json_data = line[len("data:"):].strip()
                                break

                        if not json_data:
                            continue

                        if json_data == "[DONE]":
                            yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"
                            return

                        try:
                            data = json.loads(json_data)
                            if "choices" in data and data["choices"]:
                                delta_content = data["choices"][0]["delta"].get("content", "")
                                if delta_content:
                                    yield f"data: {json.dumps({'content': delta_content, 'done': False})}\n\n"
                        except json.JSONDecodeError:
                            yield f"data: {json.dumps({'error': f'Malformed JSON chunk: {json_data}', 'done': False})}\n\n"
                            continue
                
                if buffer.strip():
                    pass

    except httpx.RequestError as e:
        yield f"data: {json.dumps({'error': f'Request error communicating with AI: {str(e)}', 'done': True})}\n\n"
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        error_text = e.response.text
        yield f"data: {json.dumps({'error': f'AI service error ({status_code}): {error_text}', 'done': True})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': f'An unexpected error occurred during AI streaming: {str(e)}', 'done': True})}\n\n"

def count_tokens(text: str) -> int:
    return len(text.split())

MAX_HISTORY_TOKENS = 2000
MAX_PDF_TOKENS = 4000

@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        content = await file.read()
        full_text = extract_text_from_pdf(content)

        if not full_text.strip():
            raise HTTPException(status_code=400, detail="No text found in PDF. The PDF might be image-based or empty.")

        pdf_id = str(uuid.uuid4())
        
        temporary_pdf_cache[pdf_id] = {
            "filename": file.filename,
            "content": full_text,
            "uploaded_at": datetime.now()
        }

        return {
            "pdf_id": pdf_id,
            "filename": file.filename,
            "message": "PDF uploaded and stored in temporary memory successfully. It will be lost on server restart.",
            "content_preview": full_text[:200] + "..." if len(full_text) > 200 else full_text
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error during PDF upload: {str(e)}")

@app.post("/chat-stream")
async def chat_stream(request: ChatRequest = Body(...)):
    try:
        await create_session_in_db(request.session_id)
        session_messages = await get_session_messages_from_db(request.session_id)

        user_message = ChatMessage(
            role="user",
            content=request.message,
            timestamp=datetime.now()
        )
        session_messages.append(user_message)

        api_messages = [{"role": "system", "content": "You are a helpful AI assistant."}]

        if request.use_pdf and request.pdf_ids:
            combined_pdf_context = ""
            current_pdf_tokens = 0
            for pdf_id in request.pdf_ids:
                pdf_data = temporary_pdf_cache.get(pdf_id)
                if pdf_data and pdf_data.get("content"):
                    pdf_content = pdf_data["content"]
                    content_tokens = count_tokens(pdf_content)
                    
                    if current_pdf_tokens + content_tokens > MAX_PDF_TOKENS:
                        remaining_tokens = MAX_PDF_TOKENS - current_pdf_tokens
                        if remaining_tokens > 0:
                            truncated_content = " ".join(pdf_content.split()[:remaining_tokens])
                            if len(pdf_content.split()) > remaining_tokens:
                                truncated_content += "..."
                            combined_pdf_context += f"\n--- PDF Context from {pdf_data['filename']} ---\n{truncated_content}"
                            current_pdf_tokens += count_tokens(truncated_content)
                        break
                    else:
                        combined_pdf_context += f"\n--- PDF Context from {pdf_data['filename']} ---\n{pdf_content}"
                        current_pdf_tokens += content_tokens
                else:
                    print(f"Warning: PDF ID '{pdf_id}' requested but not found in temporary cache.") 

            if combined_pdf_context:
                api_messages.append({"role": "system", "content": f"Here is some relevant document context:\n{combined_pdf_context.strip()}\n\nBased on this context and our conversation, please answer the user's questions. If the context is insufficient or not relevant, state that you cannot answer based on the provided documents."})

        messages_to_send_to_llm = []
        for msg_dict in api_messages:
            messages_to_send_to_llm.append(msg_dict)
        
        current_tokens_in_llm_prompt = sum(count_tokens(msg_dict["content"]) for msg_dict in messages_to_send_to_llm)

        for msg in session_messages:
            if msg == user_message:
                continue
            
            msg_tokens = count_tokens(msg.content)
            if current_tokens_in_llm_prompt + msg_tokens <= MAX_HISTORY_TOKENS:
                messages_to_send_to_llm.append({"role": msg.role, "content": msg.content})
                current_tokens_in_llm_prompt += msg_tokens
            else:
                remaining_tokens = MAX_HISTORY_TOKENS - current_tokens_in_llm_prompt
                if remaining_tokens > 0:
                    truncated_content = " ".join(msg.content.split()[:remaining_tokens]) + "..."
                    messages_to_send_to_llm.append({"role": msg.role, "content": truncated_content})
                    current_tokens_in_llm_prompt += count_tokens(truncated_content)
                break

        messages_to_send_to_llm.append({"role": user_message.role, "content": user_message.content})

        full_ai_response_content = ""

        async def stream_response_generator():
            nonlocal full_ai_response_content
            try:
                async for chunk_data in stream_ai_response_from_openrouter(messages_to_send_to_llm):
                    if chunk_data.startswith("data:"):
                        json_part = chunk_data[len("data:"):].strip()
                        if json_part == "[DONE]":
                            yield chunk_data
                            break
                        try:
                            data = json.loads(json_part)
                            if "content" in data and not data.get("done"):
                                full_ai_response_content += data["content"]
                            elif "error" in data:
                                yield chunk_data
                                full_ai_response_content = f"Error: {data['error']}"
                                break
                        except json.JSONDecodeError:
                            yield f"data: {json.dumps({'error': 'Failed to decode JSON from AI stream', 'done': False})}\n\n"
                            continue
                    yield chunk_data
            except Exception as gen_e:
                yield f"data: {json.dumps({'error': f'Streaming interrupted unexpectedly: {str(gen_e)}', 'done': True})}\n\n"
                full_ai_response_content = f"Error: Streaming interrupted unexpectedly: {str(gen_e)}"
            finally:
                if full_ai_response_content:
                    assistant_message = ChatMessage(
                        role="assistant",
                        content=full_ai_response_content,
                        timestamp=datetime.now()
                    )
                    await add_message_to_session_in_db(request.session_id, user_message)
                    await add_message_to_session_in_db(request.session_id, assistant_message)
                else:
                    await add_message_to_session_in_db(request.session_id, user_message)


        return StreamingResponse(
            stream_response_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: Could not initiate chat stream: {str(e)}")

@app.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    messages = await get_session_messages_from_db(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="Session not found or no messages.")
    return SessionResponse(session_id=session_id, messages=messages)

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    await delete_session_from_db(session_id)
    return {"message": f"Session '{session_id}' deleted successfully"}

@app.get("/sessions")
async def list_sessions():
    session_ids = await list_sessions_from_db()
    return {
        "sessions": session_ids,
        "total_sessions": len(session_ids)
    }

@app.get("/pdfs")
async def list_pdfs():
    pdfs_list = []
    for pdf_id, data in temporary_pdf_cache.items():
        pdfs_list.append({
            "id": pdf_id,
            "filename": data["filename"],
            "uploaded_at": data["uploaded_at"]
        })
    return {
        "pdfs": pdfs_list,
        "total_pdfs": len(pdfs_list),
        "note": "These PDFs are stored temporarily in server memory and are lost on server restart."
    }

@app.get("/")
async def root():
    return {"message": "AI Chatbot API is running with temporary PDF memory and SQLite (History)!"}

@app.get("/health")
async def health_check():
    try:
        await list_sessions_from_db() 
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {e}"

    return {
        "status": "healthy", 
        "timestamp": datetime.now(),
        "database_status": db_status,
        "pdf_cache_size": len(temporary_pdf_cache),
        "pdf_cache_note": "PDFs are stored temporarily in memory and are lost on server restart.",
        "embedding_model_status": "N/A (RAG and embedding model not used)"
    }

