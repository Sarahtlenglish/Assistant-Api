import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import dotenv from "dotenv";
import morgan from "morgan";
import Airtable from 'airtable';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(morgan("combined"));
app.use(express.static('static')); // Serve static files

const apiKey = process.env.OPENAI_API_KEY;
const assistant_id = process.env.ASSISTANT_ID; // Your Assistant ID
const openai = new OpenAI({ apiKey: apiKey });

var base = new Airtable({apiKey: process.env.AIRTABLE_BEARER_TOKEN}).base(process.env.AIRTABLE_BASE_ID);

// Endpoint to handle chat
app.post("/chat", async (req, res) => {
  try {
    if (!req.body.message || !req.body.sessionId) {
      return res.status(400).json({ error: "Message and SessionId fields are required" });
    }
    const { message: userMessage, sessionId } = req.body;

    // Retrieve or create a thread ID for the session
    let threadId = await getOrCreateThreadIdForSession(sessionId);

    // Add a Message to a Thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // Run the Assistant
    const runResponse = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistant_id,
    });

    // Check the Run status and retrieve the response
    let run = await openai.beta.threads.runs.retrieve(threadId, runResponse.id);
    while (run.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await openai.beta.threads.runs.retrieve(threadId, runResponse.id);
    }

    const messagesResponse = await openai.beta.threads.messages.list(threadId);
    const assistantResponses = messagesResponse.data.filter(msg => msg.role === 'assistant');
    const response = assistantResponses.map(msg => 
      msg.content
        .filter(contentItem => contentItem.type === 'text')
        .map(textContent => textContent.text.value)
        .join('\n')
    ).join('\n');

    // Respond to the user
    res.json({ response });
  } catch (error) {
    console.error("Error processing chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Function to get or create a thread ID for a session
async function getOrCreateThreadIdForSession(sessionId) {
  let threadId = null;
  // Search for an existing conversation for the session
  const records = await base('Conversations').select({
    filterByFormula: `{SessionID} = '${sessionId}'`
  }).firstPage();

  if (records.length > 0) {
    // If a conversation exists, use the stored thread ID
    threadId = records[0].fields.ThreadID;
  } else {
    // If no conversation exists, create a new thread
    const threadResponse = await openai.beta.threads.create();
    threadId = threadResponse.id;
    // Save the new conversation with the session ID and thread ID in Airtable
    await base('Conversations').create([{ "fields": { "SessionID": sessionId, "ThreadID": threadId } }]);
  }
  return threadId;
}

// ... (rest of your code, including the Airtable 'Leads' handling)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
