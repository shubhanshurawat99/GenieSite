const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for local development
const corsOptions = {
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Helper function to safely stringify JSON for SSE
const safeJSONStringify = (obj) => {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    console.error('JSON stringify error:', error);
    return JSON.stringify({
      type: 'error',
      error: 'JSON serialization failed',
      details: 'Invalid characters in response'
    });
  }
};

// Helper function to send SSE data safely
const sendSSEData = (res, data) => {
  const jsonString = safeJSONStringify(data);
  res.write(`data: ${jsonString}\n\n`);
};

// Function to clean generated code and fix href issues
const cleanGeneratedCode = (rawCode) => {
  let cleaned = rawCode.replace(/```html\n?/g, '').replace(/```\n?/g, '');
  cleaned = cleaned.trim();
  
  const htmlStart = cleaned.indexOf('<!DOCTYPE html>');
  if (htmlStart !== -1) {
    cleaned = cleaned.substring(htmlStart);
  } else {
    const htmlTagStart = cleaned.indexOf('<html');
    if (htmlTagStart !== -1) {
      cleaned = cleaned.substring(htmlTagStart);
    }
  }
  
  const htmlEnd = cleaned.lastIndexOf('</html>');
  if (htmlEnd !== -1) {
    cleaned = cleaned.substring(0, htmlEnd + 7);
  }
  
  cleaned = cleaned.replace(/href\s*=\s*["']#["']/g, 'href="javascript:void(0)"');
  cleaned = cleaned.replace(/href\s*=\s*["']#([^"']+)["']/g, (match, anchor) => {
    return `href="javascript:void(0)" data-scroll-to="${anchor}"`;
  });
  
  if (cleaned.includes('data-scroll-to')) {
    const scriptToAdd = `
    <script>
    document.addEventListener('DOMContentLoaded', function() {
      const anchorLinks = document.querySelectorAll('[data-scroll-to]');
      anchorLinks.forEach(link => {
        link.addEventListener('click', function(e) {
          e.preventDefault();
          const targetId = this.getAttribute('data-scroll-to');
          const targetElement = document.getElementById(targetId);
          if (targetElement) {
            targetElement.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }
        });
      });
      
      const hashLinks = document.querySelectorAll('a[href="javascript:void(0)"]');
      hashLinks.forEach(link => {
        link.addEventListener('click', function(e) {
          e.preventDefault();
        });
      });
    });
    </script>`;
    
    if (cleaned.includes('</body>')) {
      cleaned = cleaned.replace('</body>', scriptToAdd + '\n</body>');
    } else if (cleaned.includes('</html>')) {
      cleaned = cleaned.replace('</html>', scriptToAdd + '\n</html>');
    }
  }
  
  return cleaned;
};

// Main route - matches frontend's expected endpoint
// At top, after loading env:
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is missing. Please set it in environment variables.');
  // Note: don't exit the process here in dev; just log so it's visible.
}

// ...existing code...

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log(`📝 Generating website for prompt: "${prompt}"`);

    // set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control"
    });

    const fullPrompt = `Create a complete HTML website based on: "${prompt}".\n\nRequirements:\n- Single HTML file with embedded CSS and JavaScript\n- Modern, responsive design\n- ... (same as before)`;

    let thoughts = "";
    let rawAnswer = "";
    let thoughtsStarted = false;
    let answerStarted = false;
    let progressCounter = 0;

    try {
      const response = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: fullPrompt,
        config: {
          thinkingConfig: {
            includeThoughts: true,
          },
        },
      });

      for await (const chunk of response) {
        // robust handling: ensure chunk.candidates exists and is iterable
        if (!chunk || !Array.isArray(chunk.candidates) || !chunk.candidates[0]) {
          continue;
        }

        const candidate = chunk.candidates[0];
        if (!candidate.content || !Array.isArray(candidate.content.parts)) continue;

        for (const part of candidate.content.parts) {
          if (!part || !part.text) continue;

          if (part.thought) {
            if (!thoughtsStarted) {
              sendSSEData(res, {
                type: 'thoughts_start',
                message: 'AI is thinking...'
              });
              thoughtsStarted = true;
              console.log('🧠 AI thinking process started...');
            }

            const cleanThoughtText = part.text.replace(/[\r\n]+/g, ' ').trim();
            thoughts += cleanThoughtText + ' ';

            sendSSEData(res, {
              type: 'thoughts',
              content: cleanThoughtText + ' '
            });

            // small pause to make SSE readable in frontend (optional)
            await new Promise(resolve => setTimeout(resolve, 40));
          } else {
            if (!answerStarted) {
              sendSSEData(res, {
                type: 'answer_start',
                message: 'Generating code...'
              });
              answerStarted = true;
              console.log('⚙️  Code generation started...');
            }

            rawAnswer += part.text;
            progressCounter++;

            const estimatedProgress = Math.min((progressCounter * 2), 95);
            sendSSEData(res, {
              type: 'progress',
              message: 'Generating code...',
              progress: estimatedProgress
            });
          }
        }
      }

      // finish
      console.log('🔧 Cleaning generated code...');
      const cleanedCode = cleanGeneratedCode(rawAnswer);

      if (!cleanedCode || (!cleanedCode.includes('<html') && !cleanedCode.includes('<!DOCTYPE'))) {
        throw new Error('Generated code does not contain valid HTML structure');
      }

      console.log('✅ Website generated successfully!');
      sendSSEData(res, {
        type: 'complete',
        success: true,
        code: cleanedCode,
        thoughts: thoughts.trim()
      });

    } catch (streamError) {
      console.error('❌ Streaming error:', streamError && streamError.message ? streamError.message : streamError);
      try {
        sendSSEData(res, {
          type: 'error',
          error: 'Stream processing failed',
          details: streamError && streamError.message ? streamError.message : String(streamError)
        });
      } catch (sseErr) {
        console.error('❌ Failed to send SSE error event:', sseErr);
      }
    } finally {
      // end the SSE connection
      try {
        res.end();
      } catch (e) {
        console.warn('res.end() failed:', e);
      }
    }

  } catch (error) {
    console.error('❌ Error generating website:', error);

    if (!res.headersSent) {
      try {
        res.writeHead(500, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Cache-Control"
        });
      } catch (e) {
        console.warn('Failed to write headers in fallback error handler:', e);
      }
    }

    try {
      sendSSEData(res, {
        type: 'error',
        error: 'Failed to generate website',
        details: error.message
      });
    } catch (e) {
      console.error('❌ Final error sending response:', e);
    }

    try { res.end(); } catch (e) { /* ignore */ }
  }
});


// Legacy endpoint (for backward compatibility)
app.post('/api/generate-website', async (req, res) => {
  console.log('⚠️  Legacy endpoint called, redirecting to /api/generate');
  req.url = '/api/generate';
  return app._router.handle(req, res);
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ 
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'GenieSite API Server',
    version: '1.0.0',
    endpoints: {
      generate: 'POST /api/generate',
      health: 'GET /health'
    }
  });
});

app.listen(PORT, () => {
  console.log('\n🚀 ===================================');
  console.log(`🚀 GenieSite Server is running!`);
  console.log(`🚀 ===================================`);
  console.log(`📡 Server URL: http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/generate`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🚀 ===================================\n`);
});