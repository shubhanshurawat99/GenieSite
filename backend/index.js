const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT_KEY || 5000;
const corsOptions = {
  origin: ['https://storage.googleapis.com', 'https://storage.googleapis.com/promtweb/dist/index.html'],
  credentials: true, // If you send cookies or authorization headers
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

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
  // Replace href="#" with href="javascript:void(0)" to prevent navigation
  cleaned = cleaned.replace(/href\s*=\s*["']#["']/g, 'href="javascript:void(0)"');
  
  // Also handle href="#something" patterns for anchor links
  cleaned = cleaned.replace(/href\s*=\s*["']#([^"']+)["']/g, (match, anchor) => {
    return `href="javascript:void(0)" data-scroll-to="${anchor}"`;
  });
  
  // Add a script to handle smooth scrolling for anchor links if not already present
  if (!cleaned.includes('data-scroll-to') || cleaned.includes('data-scroll-to')) {
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
            res.write(`data: ${JSON.stringify({
              type: 'thoughts_start',
              message: 'AI is thinking...'
            })}\n\n`);
            thoughtsStarted = true;
          }
          
          // Stream thoughts in smaller chunks for smoother display
          const words = part.text.split(' ');
          for (const word of words) {
            thoughts += word + ' ';
            res.write(`data: ${JSON.stringify({
              type: 'thoughts',
              content: word + ' '
            })}\n\n`);
            
            // Small delay for word-by-word effect
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else {
          // Handle answer (code generation)
          if (!answerStarted) {
            res.write(`data: ${JSON.stringify({
              type: 'answer_start',
              message: 'Generating code...'
            })}\n\n`);
            answerStarted = true;
          }
          
          // Accumulate raw answer but don't send code chunks to frontend
          rawAnswer += part.text;
          
          // Send progress indicator instead of actual code chunks
          res.write(`data: ${JSON.stringify({
            type: 'progress',
            message: 'Generating code...',
            progress: Math.min(rawAnswer.length / 1000, 95) // Rough progress indicator
          })}\n\n`);
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
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      success: true,
      code: cleanedCode,
      thoughts: thoughts.trim()
    })}\n\n`);
    
    res.end();
    
  } catch (error) {
    console.error('Error generating website:', error);
    
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: 'Failed to generate website',
      details: error.message
    })}\n\n`);
    
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