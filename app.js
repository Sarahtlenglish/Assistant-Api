import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import fs from "fs";
import path from "path"; // Add this import for serving static files
import cors from "cors"; // Add this import for CORS support
import dotenv from "dotenv";
import morgan from "morgan";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(morgan("combined"));
app.use(express.static('static'));
const apiKey = process.env.OPENAI_API_KEY;
const assistant_id = process.env.ASSISTANT_ID; // Read the assistant_id from environment variable
const openai = new OpenAI({ apiKey: apiKey });
;

// Endpoint to handle chat
app.post("/chat", async (req, res) => {
  try {
    if (!req.body.message) {
      return res.status(400).json({ error: "Message field is required" });
    }
    const userMessage = req.body.message;

    // Create a Thread
    const threadResponse = await openai.beta.threads.create();
    const threadId = threadResponse.id;

    // Add a Message to a Thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // Run the Assistant
    const runResponse = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistant_id,
    });

    // Check the Run status
    let run = await openai.beta.threads.runs.retrieve(threadId, runResponse.id);
    while (run.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await openai.beta.threads.runs.retrieve(threadId, runResponse.id);
    }

    // Display the Assistant's Response
const messagesResponse = await openai.beta.threads.messages.list(threadId);
const assistantResponses = messagesResponse.data.filter(msg => msg.role === 'assistant');
const response = assistantResponses.map(msg => 
  msg.content
    .filter(contentItem => contentItem.type === 'text')
    .map(textContent => textContent.text.value)
    .join('\n')
).join('\n');

res.json({ response });

  } catch (error) {
    console.error("Error processing chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
