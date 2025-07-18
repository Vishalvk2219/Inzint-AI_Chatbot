import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const App = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [uploadedPdfs, setUploadedPdfs] = useState([]);
  const [activePdfs, setActivePdfs] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [chatSessions, setChatSessions] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const sidebarRef = useRef(null);
  const isInitialMount = useRef(true);

  const API_BASE_URL = 'http://localhost:8000';
  const MAX_PDFS = 3;

  useEffect(() => {
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    loadChatSessions();

    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isInitialMount.current || streamingMessage) {
      scrollToBottom();
    } else {
      isInitialMount.current = false;
    }
  }, [messages, streamingMessage]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (window.innerWidth <= 768 && sidebarOpen) {
        if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
          setSidebarOpen(false);
        }
      }
    };

    if (window.innerWidth <= 768 && sidebarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [sidebarOpen]);

  const generateSessionId = () => {
    return 'session_' + Math.random().toString(36).substr(2, 9);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadChatSessions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions`);
      if (response.ok) {
        const data = await response.json();
        const sessionsWithTitles = await Promise.all(
          data.sessions.map(async (session) => {
            try {
              const sessionResponse = await fetch(`${API_BASE_URL}/sessions/${session}`);
              if (sessionResponse.ok) {
                const sessionData = await sessionResponse.json();
                const firstUserMessage = sessionData.messages.find(msg => msg.role === 'user');
                const title = firstUserMessage
                  ? firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '')
                  : 'New Chat';

                return {
                  id: session,
                  title: title,
                  messageCount: sessionData.messages.length,
                  lastActivity: sessionData.messages.length > 0 ?
                    sessionData.messages[sessionData.messages.length - 1].timestamp : null
                };
              } else {
                console.error(`Failed to load session ${session}: ${sessionResponse.statusText}`);
                return { id: session, title: 'Error Loading Chat', messageCount: 0, lastActivity: null, error: true };
              }
            } catch (error) {
              console.error(`Error loading session ${session}:`, error);
              return { id: session, title: 'Error Loading Chat', messageCount: 0, lastActivity: null, error: true };
            }
          })
        );
        setChatSessions(sessionsWithTitles.filter(s => !s.error).sort((a, b) =>
          new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0)
        ));
      }
    } catch (error) {
      console.error('Error loading chat sessions:', error);
    }
  };

  const createNewChat = () => {
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setMessages([]);
    setStreamingMessage('');
    setIsStreaming(false);
    setActivePdfs([]);
    loadChatSessions();
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  };

  const switchToSession = async (sessionIdToLoad) => {
    try {
      setSessionId(sessionIdToLoad);
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingMessage('');

      const response = await fetch(`${API_BASE_URL}/sessions/${sessionIdToLoad}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
        setActivePdfs([]);
      } else {
        console.error(`Failed to load session ${sessionIdToLoad}. Creating a new chat.`);
        createNewChat();
      }
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
    } catch (error) {
      console.error('Error switching to session:', error);
      createNewChat();
    }
  };

  const deleteSession = async (sessionIdToDelete, event) => {
    event.stopPropagation();
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionIdToDelete}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        if (sessionIdToDelete === sessionId) {
          createNewChat();
        }
        loadChatSessions();
      } else {
        console.error(`Failed to delete session ${sessionIdToDelete}: ${response.statusText}`);
        alert('Failed to delete chat session.');
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Error deleting chat session.');
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);
    setStreamingMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/chat-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: currentInput,
          session_id: sessionId,
          use_pdf: activePdfs.length > 0,
          pdf_ids: activePdfs.map(pdf => pdf.id)
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                throw new Error(data.error);
              }
              if (data.content) {
                fullResponse += data.content;
                setStreamingMessage(fullResponse);
              }
              if (data.done) {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: fullResponse,
                  timestamp: new Date().toISOString()
                }]);
                setStreamingMessage('');
                setIsStreaming(false);
                loadChatSessions();
                return;
              }
            } catch (e) {
              console.error('Error parsing streaming data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingMessage('');
    }
  };

  const uploadPdf = async (file) => {
    if (uploadedPdfs.length >= MAX_PDFS) {
      alert(`Maximum ${MAX_PDFS} PDFs allowed. Please delete a PDF before uploading a new one.`);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE_URL}/upload-pdf`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        const newPdf = {
          ...data,
          id: data.pdf_id || Date.now() + Math.random(),
          uploadedAt: new Date().toISOString()
        };
        setUploadedPdfs(prev => [...prev, newPdf]);
        alert(`PDF "${data.filename}" uploaded successfully!`);
      } else {
        throw new Error(data.detail || 'Failed to upload PDF');
      }
    } catch (error) {
      console.error('Error uploading PDF:', error);
      alert('Error uploading PDF: ' + error.message);
    }
  };

  const deletePdf = (pdfId) => {
    setUploadedPdfs(prev => prev.filter(pdf => pdf.id !== pdfId));
    setActivePdfs(prev => prev.filter(pdf => pdf.id !== pdfId));
  };

  const togglePdfActive = (pdf) => {
    setActivePdfs(prev => {
      const isActive = prev.some(p => p.id === pdf.id);
      if (isActive) {
        return prev.filter(p => p.id !== pdf.id);
      } else {
        return [...prev, pdf];
      }
    });
  };

  const resetChat = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        console.warn(`Failed to delete session ${sessionId} on backend: ${response.statusText}. Continuing with client-side reset.`);
      }
    } catch (error) {
      console.error('Error contacting backend to reset chat:', error);
    } finally {
      createNewChat();
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
      uploadPdf(file);
    } else {
      alert('Please select a PDF file.');
    }
    event.target.value = '';
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="app">
      <div className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`} ref={sidebarRef}>
        <div className="sidebar-header">
          <button
            className="new-chat-btn"
            onClick={createNewChat}
            disabled={isLoading}
            title="Start a New Chat"
          >
            <span className="icon">➕</span>
            <span className="new-chat-text">New Chat</span>
          </button>
        </div>

        <div className="sidebar-content">
          <div className="chat-history-section">
            <h3>Chat History</h3>
            <div className="chat-sessions">
              {chatSessions.length === 0 ? (
                <div className="no-sessions">No chat sessions yet. Start a new chat!</div>
              ) : (
                chatSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`chat-session ${session.id === sessionId ? 'active' : ''} ${session.error ? 'error' : ''}`}
                    onClick={() => switchToSession(session.id)}
                    title={session.title}
                  >
                    <div className="session-info">
                      <div className="session-title">{session.title}</div>
                      <div className="session-meta">
                        <span>{session.messageCount} messages</span>
                        {session.lastActivity && (
                          <span className="last-activity">
                            {new Date(session.lastActivity).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="delete-session"
                      onClick={(e) => deleteSession(session.id, e)}
                      title="Delete chat"
                      aria-label={`Delete chat session ${session.title}`}
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pdf-section">
            <h4>PDF Documents</h4>
            <div className="pdf-upload">
              <button
                className="upload-pdf-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || uploadedPdfs.length >= MAX_PDFS}
                title={`Upload PDF (${uploadedPdfs.length}/${MAX_PDFS} allowed)`}
              >
                <span className="icon">📎</span>
                <span className="upload-pdf-text">Upload PDF ({uploadedPdfs.length}/{MAX_PDFS})</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>

            <div className="pdf-list">
              {uploadedPdfs.length === 0 ? (
                <div className="no-pdfs">No PDFs uploaded yet.</div>
              ) : (
                uploadedPdfs.map((pdf) => (
                  <div key={pdf.id} className="pdf-item">
                    <div className="pdf-info">
                      <div className="pdf-name" title={pdf.filename}>
                        📄 {pdf.filename}
                      </div>
                    </div>
                    <div className="pdf-actions">
                      <button
                        className={`use-pdf-btn ${activePdfs.some(p => p.id === pdf.id) ? 'active' : ''}`}
                        onClick={() => togglePdfActive(pdf)}
                        disabled={isLoading}
                        title={activePdfs.some(p => p.id === pdf.id) ? 'Deactivate PDF for chat' : 'Activate PDF for chat'}
                        aria-label={activePdfs.some(p => p.id === pdf.id) ? 'Deactivate' : 'Activate'}
                      >
                        {activePdfs.some(p => p.id === pdf.id) ? '✓' : '○'}
                      </button>
                      <button
                        className="delete-pdf-btn"
                        onClick={() => deletePdf(pdf.id)}
                        disabled={isLoading}
                        title="Delete PDF"
                        aria-label={`Delete PDF ${pdf.filename}`}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          <div className="header-left">
            {window.innerWidth <= 768 && (
              <button
                className="sidebar-toggle mobile-toggle"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
              >
                ☰
              </button>
            )}
            <h1>QuantumMind AI</h1>
          </div>

          <div className="header-controls">
            <button
              className="reset-btn"
              onClick={resetChat}
              disabled={isLoading}
              title="Reset current chat"
            >
              🔄 Reset Chat
            </button>
          </div>
        </div>

        {activePdfs.length > 0 && (
          <div className="active-pdfs-info">
            <div className="active-pdfs-text">
              <strong>Active PDFs:</strong> {activePdfs.map(pdf => pdf.filename).join(', ')}
            </div>
          </div>
        )}

        <div className="messages-container">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <div className="message-content">
                <div className="message-text">
                  {message.content}
                </div>
                <div className="message-timestamp">
                  {message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            </div>
          ))}

          {isStreaming && streamingMessage && (
            <div className="message assistant">
              <div className="message-content">
                <div className="message-text">
                  {streamingMessage}
                  <span className="streaming-cursor">|</span>
                </div>
              </div>
            </div>
          )}

          {isLoading && !isStreaming && (
            <div className="message assistant">
              <div className="message-content">
                <div className="message-text">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message here..."
            disabled={isLoading}
            rows={1}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = (e.target.scrollHeight) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="send-btn"
            title="Send message"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>

        <div className="status-bar">
          <span>Session ID: {sessionId}</span>
          <span>Mode: Streaming</span>
          {activePdfs.length > 0 && <span>✓ Using {activePdfs.length} PDF(s)</span>}
        </div>
      </div>
      {window.innerWidth <= 768 && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
      )}
    </div>
  );
};

export default App;