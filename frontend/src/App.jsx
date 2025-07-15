  import React, { useState, useRef, useEffect } from 'react';

  const App = () => {
    const [messages, setMessages] = useState([
      { id: 1, type: 'ai', content: "Hello! I'm here to help you build amazing websites. Just describe what you want!", timestamp: new Date() }
    ]);
    const [input, setInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [currentCode, setCurrentCode] = useState('');
    const [activeTab, setActiveTab] = useState('preview');
    const [isTyping, setIsTyping] = useState(false);
    const [generationProgress, setGenerationProgress] = useState(0);
    
    const chatRef = useRef(null);
    const messageId = useRef(2);

    // Auto-scroll chat
    useEffect(() => {
      if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    }, [messages, isTyping]);

    const formatThoughts = (rawThoughts) => {
      if (!rawThoughts) return '';
      return rawThoughts;
    };

    const addMessage = (type, content, isThought = false) => {
      const newMessage = {
        id: messageId.current++,
        type,
        content,
        timestamp: new Date(),
        isThought
      };
      setMessages(prev => [...prev, newMessage]);
      return newMessage.id;
    };

    const updateMessage = (id, content) => {
      setMessages(prev => prev.map(msg => 
        msg.id === id ? { ...msg, content } : msg
      ));
    };

    const sendMessage = () => {
      const message = input.trim();
      if (!message || isGenerating) return;

      addMessage('user', message);
      setInput('');
      generateWebsite(message);
    };

    const generateWebsite = async (prompt) => {
      setIsGenerating(true);
      setIsTyping(true);
      setGenerationProgress(0);
      setCurrentCode(''); // Clear previous code
      setActiveTab('code'); // Switch to code tab automatically
      
      try {
        const response = await fetch('https://geniesite-532228050988.europe-west1.run.app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let thoughtsContent = '';
        let thoughtsId = null;
        let progressMessageId = null;
        
        const processStream = async () => {
          const { done, value } = await reader.read();
          if (done) {
            setIsTyping(false);
            setIsGenerating(false);
            setGenerationProgress(0);
            return;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                
                switch (data.type) {
                  case 'thoughts_start':
                    setIsTyping(false);
                    break;
                    
                  case 'thoughts':
                    thoughtsContent += data.content;
                    if (!thoughtsId) {
                      thoughtsId = addMessage('ai', thoughtsContent, true);
                    } else {
                      updateMessage(thoughtsId, thoughtsContent);
                    }
                    break;
                    
                  case 'answer_start':
                    progressMessageId = addMessage('ai', 'Starting code generation...');
                    break;
                    
                  case 'progress':
                    // Update progress message and progress bar
                    if (progressMessageId) {
                      updateMessage(progressMessageId, `${data.message} (${Math.round(data.progress)}%)`);
                    }
                    setGenerationProgress(data.progress);
                    break;
                    
                  case 'complete':
                    // Only update the code when generation is complete
                    setCurrentCode(data.code);
                    if (progressMessageId) {
                      updateMessage(progressMessageId, '✅ Website generated successfully!');
                    }
                    setActiveTab('preview'); // Switch to preview when done
                    setGenerationProgress(100);
                    break;
                    
                  case 'error':
                    addMessage('ai', '❌ Error: ' + data.error);
                    setGenerationProgress(0);
                    break;
                }
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }
          
          return processStream();
        };
        
        await processStream();
      } catch (error) {
        setIsTyping(false);
        setIsGenerating(false);
        setGenerationProgress(0);
        addMessage('ai', '❌ Failed to generate website. Please try again.');
      }
    };

    const copyCode = () => {
      if (currentCode) {
        navigator.clipboard.writeText(currentCode);
        // Simple toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #10b981;
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          z-index: 1000;
          font-size: 14px;
        `;
        toast.textContent = 'Code copied to clipboard!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      }
    };

    const exportCode = () => {
      if (currentCode) {
        const blob = new Blob([currentCode], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'website.html';
        a.click();
        URL.revokeObjectURL(url);
      }
    };

    const clearChat = () => {
      setMessages([{ id: 1, type: 'ai', content: "Chat cleared! What website would you like to create?", timestamp: new Date() }]);
      setCurrentCode('');
      setGenerationProgress(0);
      messageId.current = 2;
    };

    return (
      <div className="h-screen bg-base-100 flex flex-col">
        {/* Add styles for thought formatting */}
        <style jsx>{`
          .thought-line {
            font-size: 13px;
            margin: 4px 0;
            padding: 4px 8px;
            line-height: 1.5;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 4px;
            border-left: 2px solid rgba(255, 255, 255, 0.3);
          }
        `}</style>
        
        {/* Header */}
        <div className="navbar bg-base-200 shadow-sm">
          <div className="flex-1">
            <div className="text-xl font-bold text-primary">
              <i className="fas fa-code mr-2"></i>GenieSite
            </div>
          </div>
          <div className="flex-none">
            <div className="dropdown dropdown-end">
              <div tabIndex={0} className="btn btn-ghost btn-sm">
                <i className="fas fa-ellipsis-v"></i>
              </div>
              <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-40">
                <li><a onClick={clearChat}>Clear Chat</a></li>
                <li><a onClick={exportCode} className={currentCode ? '' : 'disabled'}>Export HTML</a></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Chat Panel */}
          <div className="w-1/3 border-r border-base-300 flex flex-col">
            {/* Chat Messages */}
            <div ref={chatRef} className="flex-1 p-4 overflow-y-auto space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`chat ${msg.type === 'user' ? 'chat-end' : 'chat-start'}`}>
                  <div className="chat-image avatar">
                    <div className={`w-8 rounded-full ${msg.type === 'user' ? 'bg-secondary' : 'bg-primary'} flex items-center justify-center`}>
                      <i className={`fas ${msg.type === 'user' ? 'fa-user' : msg.isThought ? 'fa-brain' : 'fa-robot'} text-white text-xs`}></i>
                    </div>
                  </div>
                  <div className={`chat-bubble text-sm relative ${
                    msg.isThought ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white' : 
                    msg.type === 'user' ? 'chat-bubble-secondary' : 'chat-bubble-primary'
                  }`}>
                    {msg.isThought ? (
                      <div>
                        <div className="flex items-center mb-2">
                          <span className="font-semibold text-sm">
                            <i className="fas fa-brain mr-2"></i>
                            AI Thinking Process
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap text-sm">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="chat chat-start">
                  <div className="chat-image avatar">
                    <div className="w-8 rounded-full bg-primary flex items-center justify-center">
                      <i className="fas fa-robot text-white text-xs"></i>
                    </div>
                  </div>
                  <div className="chat-bubble">
                    <div className="flex gap-1">
                      <div className="w-1 h-1 bg-current rounded-full animate-bounce"></div>
                      <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Progress Bar */}
              {isGenerating && generationProgress > 0 && (
                <div className="px-4">
                  <div className="w-full bg-base-300 rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${generationProgress}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-center mt-1 text-base-content/70">
                    {Math.round(generationProgress)}%
                  </div>
                </div>
              )}
            </div>
            
            {/* Input */}
            <div className="p-4 border-t border-base-300">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Describe your website..."
                  className="input input-bordered input-sm flex-1"
                  disabled={isGenerating}
                />
                <button 
                  onClick={sendMessage}
                  disabled={isGenerating || !input.trim()}
                  className="btn btn-primary btn-sm"
                >
                  {isGenerating ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
                </button>
              </div>
              <div className="flex gap-1 mt-2">
                <button 
                  className="btn btn-xs btn-outline" 
                  onClick={() => setInput('Create a portfolio website')}
                  disabled={isGenerating}
                >
                  Portfolio
                </button>
                <button 
                  className="btn btn-xs btn-outline" 
                  onClick={() => setInput('Create a landing page')}
                  disabled={isGenerating}
                >
                  Landing
                </button>
                <button 
                  className="btn btn-xs btn-outline" 
                  onClick={() => setInput('Create a blog')}
                  disabled={isGenerating}
                >
                  Blog
                </button>
              </div>
            </div>
          </div>

          {/* Preview/Code Panel */}
          <div className="w-2/3 flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-base-300 bg-base-200">
              <button 
                className={`px-4 py-2 text-sm ${activeTab === 'preview' ? 'bg-base-100 border-b-2 border-primary' : ''}`}
                onClick={() => setActiveTab('preview')}
              >
                <i className="fas fa-eye mr-1"></i>Preview
              </button>
              <button 
                className={`px-4 py-2 text-sm ${activeTab === 'code' ? 'bg-base-100 border-b-2 border-primary' : ''}`}
                onClick={() => setActiveTab('code')}
              >
                <i className="fas fa-code mr-1"></i>Code
              </button>
              {currentCode && (
                <button 
                  onClick={copyCode} 
                  className="ml-auto px-4 py-2 text-sm hover:bg-base-300"
                  title="Copy code to clipboard"
                >
                  <i className="fas fa-copy mr-1"></i>Copy
                </button>
              )}
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'preview' ? (
                currentCode ? (
                  <iframe 
                    srcDoc={currentCode}
                    className="w-full h-full border-0"
                    title="Website Preview"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-base-content/50">
                    <div className="text-center">
                      <i className="fas fa-globe text-4xl mb-2"></i>
                      <p>Preview will appear here</p>
                      <p className="text-sm mt-1">Generate a website to see the preview</p>
                    </div>
                  </div>
                )
              ) : (
                <div className="p-4 h-full overflow-auto">
                  {currentCode ? (
                    <pre className="text-xs bg-base-300 p-3 rounded whitespace-pre-wrap">
                      <code>{currentCode}</code>
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full text-base-content/50">
                      <div className="text-center">
                        <i className="fas fa-file-code text-4xl mb-2"></i>
                        <p>Code will appear here</p>
                        <p className="text-sm mt-1">Generate a website to see the code</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  export default App;