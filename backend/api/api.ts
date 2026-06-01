import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';

const router = express.Router();

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function getRedirectUri() {
  return `${APP_URL}/auth/callback`;
}

// In-memory simple vector store for MVP
type DocChunk = {
  chunkId: string;
  docId: string;
  docName: string;
  text: string;
  embedding: number[];
};
const vectorStores: Record<string, DocChunk[]> = {};

let aiClient: GoogleGenAI | null = null;
function getAIClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY1 || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY or GEMINI_API_KEY1");
    // Only print prefix for debugging
    console.log(`Initializing AI client with key prefix: ${key.substring(0, 5)}...`);
    aiClient = new GoogleGenAI({ apiKey: key.trim() });
  }
  return aiClient;
}

function getOAuthCredentials() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

// === OAUTH ROUTES ===

router.get('/auth/url', (req, res) => {
  const redirectUri = getRedirectUri();
  const { clientId } = getOAuthCredentials();

  if (!clientId) {
    return res.status(500).json({ error: 'OAuth Client ID not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the environment secrets.' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  res.json({ url: authUrl });
});

router.get('/auth/status', (req, res) => {
  if (req.session.tokens?.access_token) {
    res.json({ connected: true });
  } else {
    res.json({ connected: false });
  }
});

router.post('/auth/disconnect', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Callback is defined on the main server.ts usually, but we can mount router at root or /api
// We'll export the callback handler separately to mount at /auth/callback
export const authCallbackHandler = async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  const { clientId, clientSecret } = getOAuthCredentials();

  if (!code) {
    return res.status(400).send('No code provided');
  }

  if (!clientId || !clientSecret) {
    return res.status(500).send('OAuth Configuration is missing. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.');
  }

  try {
    const redirectUri = getRedirectUri();
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
    });

    const tokens = await tokenRes.json();
    if (tokens.error) {
      throw new Error(tokens.error_description || tokens.error);
    }

    res.send(`
      <html>
        <body>
          <h2>Authentication successful!</h2>
          <p>Processing...</p>
          <script>
            const token = "${tokens.access_token}";
            try {
              localStorage.setItem('drive_auth_token', token);
            } catch(e) { console.error('localStorage err', e); }
            
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: token }, '*');
                window.close();
                setTimeout(() => {
                  document.body.innerHTML = '<h2>Authentication successful!</h2><p>You can close this window manually and return to the app.</p>';
                }, 1000);
              } else {
                document.body.innerHTML = '<h2>Authentication successful!</h2><p>You can close this window manually and return to the app.</p>';
              }
            } catch (err) {
              document.body.innerHTML = '<h2>Authentication successful!</h2><p>You can close this window manually and return to the app.</p>';
            }
          </script>
        </body>
      </html>
    `);

  } catch (err: any) {
    console.error('OAuth callback error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
};

// === DRIVE ROUTES ===

router.get('/drive/folders', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // List folders
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false");
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await driveRes.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    res.json({ folders: data.files || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/drive/index', async (req, res) => {
  const { folderId } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const sessionId = token; // use token as sessionId
  if (!sessionId) return res.status(500).json({ error: 'No session' });

  try {
    // 1. Get files in folder and recursively
    let files: any[] = [];
    let foldersToProcess = [folderId];
    let allowedDepth = 5; // prevent infinite loops

    while (foldersToProcess.length > 0 && files.length < 30 && allowedDepth > 0) {
      allowedDepth--;
      const currentFolderIds = foldersToProcess.slice(0, 5); // process up to 5 folders in this tier
      foldersToProcess = foldersToProcess.slice(5);

      for (const cFolderId of currentFolderIds) {
        if (files.length >= 30) break;

        // Find files
        const qFiles = encodeURIComponent(`'${cFolderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`);
        const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qFiles}&fields=files(id,name,mimeType)&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!filesRes.ok) {
          console.error("Files fetch failed:", filesRes.status, await filesRes.text());
        } else {
          const filesData = await filesRes.json();
          if (filesData.error) console.error("Files fetch error:", filesData.error);
          if (filesData.files) {
            files.push(...filesData.files);
          }
        }

        // Find subfolders
        const qFolders = encodeURIComponent(`'${cFolderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`);
        const foldersRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${qFolders}&fields=files(id)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!foldersRes.ok) {
          console.error("Folders fetch failed:", foldersRes.status, await foldersRes.text());
        } else {
          const foldersData = await foldersRes.json();
          if (foldersData.error) console.error("Folders fetch error:", foldersData.error);
          if (foldersData.files) {
            foldersToProcess.push(...foldersData.files.map((f: any) => f.id));
          }
        }
      }
    }

    files = files.slice(0, 30);
    let allChunks: DocChunk[] = [];
    let fileErrors: string[] = [];

    // 2. Fetch and index content
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batchFiles = files.slice(i, i + CONCURRENCY);

      await Promise.all(batchFiles.map(async (file) => {
        if (file.mimeType.startsWith('video/') || file.mimeType.startsWith('image/') || file.mimeType.startsWith('audio/') || file.mimeType.includes('zip') || file.mimeType.includes('octet-stream')) {
          console.warn(`Skipping unsupported file type ${file.mimeType} for ${file.name}`);
          return;
        }

        let text = '';
        try {
          if (file.mimeType.includes('vnd.google-apps.document') || file.mimeType.includes('vnd.google-apps.presentation')) {
            // Export google docs/slides
            const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (exportRes.ok) {
              text = await exportRes.text();
            } else {
              fileErrors.push(`Export failed for ${file.name} (${file.mimeType}): ${exportRes.status}`);
            }
          } else if (file.mimeType.includes('vnd.google-apps.spreadsheet')) {
            // Export google sheets
            const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (exportRes.ok) text = await exportRes.text();
          } else if (file.mimeType === 'application/pdf') {
            const altRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (altRes.ok) {
              const arrayBuffer = await altRes.arrayBuffer();
              // dynamically import pdf-parse to avoid top-level issues if any
              const pdfParseModule = await import('pdf-parse');
              const pdfParse = pdfParseModule.default || pdfParseModule;
              const pdfData = await pdfParse(Buffer.from(arrayBuffer));
              text = pdfData.text;
            }
          } else {
            // fallback for 'text/', 'application/x-markdown', 'application/octet-stream' (markdown sometimes), etc.
            const altRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (altRes.ok) {
              text = await altRes.text();
            } else {
              fileErrors.push(`Fetch failed for ${file.name} (${file.mimeType}): ${altRes.status}`);
            }
          }

          if (!text.trim()) {
            console.warn(`No text extracted for file ${file.name} (type: ${file.mimeType})`);
            return;
          }

          // Simple chunking, but fix dot to match newlines using [\s\S]
          const chunks = (text.match(/[\s\S]{1,1000}(\s|$)/g) || []).filter(c => c.trim()).slice(0, 15);
          if (chunks.length === 0) return;

          let embedRes;
          let retries = 0;
          const maxRetries = 3;
          while (retries < maxRetries) {
            try {
              embedRes = await getAIClient().models.embedContent({
                model: 'gemini-embedding-001',
                contents: chunks,
              });
              // Add delay to prevent rate limit on subsequent calls
              await new Promise(r => setTimeout(r, 200));
              break;
            } catch (err: any) {
              if (err.message && (err.message.includes('429') || err.message.includes('Quota'))) {
                retries++;
                const delayMs = Math.pow(2, retries) * 1000;
                console.warn(`Rate limit hit, retrying in ${delayMs}ms...`);
                await new Promise(r => setTimeout(r, delayMs));
              } else {
                throw err;
              }
            }
          }

          if (!embedRes) throw new Error('Failed to generate embedding after retries');

          const embeddingsList = embedRes.embeddings || (embedRes.embedding ? [embedRes.embedding] : []);
          for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            const embedding = embeddingsList[i]?.values;
            if (embedding) {
              allChunks.push({
                chunkId: uuidv4(),
                docId: file.id,
                docName: file.name,
                text: chunkText,
                embedding
              });
            }
          }
        } catch (error: any) {
          console.error(`Failed to process file ${file.name}`, error);
          fileErrors.push(`Error on ${file.name}: ${error.message || String(error)}`);

          // Propagate API key errors immediately so the user knows
          const errMsg = error.message || String(error);
          if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key')) {
            throw new Error("API KEY IS INVALID");
          }
        }
      }));
    }

    // Store in memory
    vectorStores[sessionId] = allChunks;

    if (allChunks.length === 0 && fileErrors.length > 0) {
      throw new Error("Indexing failed: " + fileErrors.join(", "));
    }

    res.json({
      success: true,
      indexedCount: allChunks.length,
      fileCount: files.length,
      files: files.map((f: any) => ({ id: f.id, name: f.name })),
      errors: fileErrors
    });
  } catch (error: any) {
    console.error('Indexing error', error);
    res.status(500).json({ error: error.message });
  }
});

// === CHAT ROUTES ===

function cosineSimilarity(a: number[], b: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

router.post('/chat', async (req, res) => {
  const { message, folderId } = req.body;
  const token = req.headers.authorization?.split(' ')[1] || 'default';
  const sessionId = token;
  const store = vectorStores[sessionId] || [];

  if (store.length === 0) {
    return res.json({ answer: "I don't have any indexed documents to answer from. Please ensure your folder was indexed successfully without errors.", citations: [] });
  }

  try {
    // 1. Embed query
    const qEmbed = await getAIClient().models.embedContent({
      model: 'gemini-embedding-001',
      contents: message,
    });
    const qValues = qEmbed.embeddings?.[0]?.values || qEmbed.embedding?.values;

    if (!qValues) throw new Error('Failed to embed query');

    // 2. Compute similarity
    const scored = store.map(c => ({
      ...c,
      score: cosineSimilarity(qValues, c.embedding)
    }));

    // Top 5 chunks
    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.slice(0, 5);

    // 3. Prompt LLM
    const contextText = topChunks.map(c => `[Document: ${c.docName}]\n${c.text}`).join('\n\n---\n\n');

    const prompt = `
System Guardrails:
You are a helpful AI assistant that answers questions strictly based on the provided document context.
If the answer cannot be found in the context, you must answer "I cannot answer this based on the provided documents."
Do not include outside knowledge.
Always cite the source document name using the provided [Document: Name] markers when making claims.

Context:
${contextText}

User Question: ${message}
`;

    const response = await getAIClient().models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    // Unique citations
    const citations = Array.from(new Set(topChunks.map(c => c.docName)));

    res.json({
      answer: response.text,
      citations
    });
  } catch (error: any) {
    console.error('Chat error', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
