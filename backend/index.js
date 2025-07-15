const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT_KEY || 5000;
const corsOptions = {
  origin: ['https://storage.googleapis.com', 'https://storage.googleapis.com/webbuilderai/dist/index.html'],
  credentials: true,
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
    // Return a safe error object
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
  // Remove markdown code blocks
  let cleaned = rawCode.replace(/```html\n?/g, '').replace(/```\n?/g, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // Remove any explanatory text before the HTML
  const htmlStart = cleaned.indexOf('<!DOCTYPE html>');
  if (htmlStart !== -1) {
    cleaned = cleaned.substring(htmlStart);
  } else {
    // If no DOCTYPE, look for <html> tag
    const htmlTagStart = cleaned.indexOf('<html');
    if (htmlTagStart !== -1) {
      cleaned = cleaned.substring(htmlTagStart);
    }
  }
  
  // Remove any text after the closing </html> tag
  const htmlEnd = cleaned.lastIndexOf('</html>');
  if (htmlEnd !== -1) {
    cleaned = cleaned.substring(0, htmlEnd + 7);
  }
  
  // Fix href="#" issues that break iframe preview
  cleaned = cleaned.replace(/href\s*=\s*["']#["']/g, 'href="javascript:void(0)"');
  
  // Also handle href="#something" patterns for anchor links
  cleaned = cleaned.replace(/href\s*=\s*["']#([^"']+)["']/g, (match, anchor) => {
    return `href="javascript:void(0)" data-scroll-to="${anchor}"`;
  });
  
  // Add a script to handle smooth scrolling for anchor links if not already present
  if (cleaned.includes('data-scroll-to')) {
    const scriptToAdd = `
    <script>
    // Handle anchor link scrolling without breaking iframe
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
      
      // Prevent any remaining # links from causing navigation
      const hashLinks = document.querySelectorAll('a[href="javascript:void(0)"]');
      hashLinks.forEach(link => {
        link.addEventListener('click', function(e) {
          e.preventDefault();
        });
      });
    });
    </script>`;
    
    // Insert the script before closing body tag
    if (cleaned.includes('</body>')) {
      cleaned = cleaned.replace('</body>', scriptToAdd + '\n</body>');
    } else if (cleaned.includes('</html>')) {
      cleaned = cleaned.replace('</html>', scriptToAdd + '\n</html>');
    }
  }
  
  return cleaned;
};

// Route to generate website code with real-time streaming
app.post('/api/generate-website', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const fullPrompt = `Create a complete HTML website based on: "${prompt}".

Requirements:
- Single HTML file with embedded CSS and JavaScript
- Modern, responsive design
- Clean, professional appearance
- Fully functional
- Use only vanilla HTML, CSS, and JavaScript
- No external libraries or frameworks
- Start with <!DOCTYPE html> and end with </html>
- Include complete HTML structure
- For navigation links that don't go to external URLs, use meaningful href attributes or proper anchor links to sections
- If using placeholder links, make them functional (either scroll to sections or show relevant content)
- Ensure all interactive elements work properly

Provide only the HTML code without explanations or markdown formatting.`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    let thoughts = "";
    let rawAnswer = "";
    let thoughtsStarted = false;
    let answerStarted = false;
    let progressCounter = 0;

    try {
      const response = await ai.models.generateContentStream({
        model: "gemini-2.5-pro",
        contents: fullPrompt,
        config: {
          thinkingConfig: {
            includeThoughts: true,
          },
        },
      });

      for await (const chunk of response) {
        for (const part of chunk.candidates[0].content.parts) {
          if (!part.text) {
            continue;
          } else if (part.thought) {
            // Handle thoughts
            if (!thoughtsStarted) {
              sendSSEData(res, {
                type: 'thoughts_start',
                message: 'AI is thinking...'
              });
              thoughtsStarted = true;
            }
            
            // Clean the thought text to avoid JSON issues
            const cleanThoughtText = part.text.replace(/[\r\n]+/g, ' ').trim();
            thoughts += cleanThoughtText + ' ';
            
            // Send thoughts in chunks, but escape properly
            sendSSEData(res, {
              type: 'thoughts',
              content: cleanThoughtText + ' '
            });
            
            // Small delay for smoother display
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            // Handle answer (code generation)
            if (!answerStarted) {
              sendSSEData(res, {
                type: 'answer_start',
                message: 'Generating code...'
              });
              answerStarted = true;
            }
            
            // Accumulate raw answer
            rawAnswer += part.text;
            progressCounter++;
            
            // Send progress indicator with better calculation
            const estimatedProgress = Math.min((progressCounter * 2), 95);
            sendSSEData(res, {
              type: 'progress',
              message: 'Generating code...',
              progress: estimatedProgress
            });
          }
        }
      }

      // Clean up the generated code only after complete generation
      const cleanedCode = cleanGeneratedCode(rawAnswer);
      
      // Validate that we have valid HTML
      if (!cleanedCode.includes('<html') && !cleanedCode.includes('<!DOCTYPE')) {
        throw new Error('Generated code does not contain valid HTML structure');
      }
      
      // Send final result with cleaned code
      sendSSEData(res, {
        type: 'complete',
        success: true,
        code: cleanedCode,
        thoughts: thoughts.trim()
      });
      
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      sendSSEData(res, {
        type: 'error',
        error: 'Stream processing failed',
        details: streamError.message
      });
    }
    
    res.end();
    
  } catch (error) {
    console.error('Error generating website:', error);
    
    // Ensure we can always send a response
    try {
      if (!res.headersSent) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Cache-Control",
        });
      }
      
      sendSSEData(res, {
        type: 'error',
        error: 'Failed to generate website',
        details: error.message
      });
    } catch (finalError) {
      console.error('Final error sending response:', finalError);
    }
    
    res.end();
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
