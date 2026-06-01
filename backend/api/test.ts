import { GoogleGenAI } from '@google/genai';

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let found = [];
  try {
    const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await listResponse.json();
    for (const m of (data.models || [])) {
        if (m.name.includes('embed')) found.push(m.name);
    }
    console.log("Models:", found);
  } catch (e) {
    console.error(e);
  }
}
test();
