import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import dotenv from "dotenv";
import morgan from "morgan";
import Airtable from 'airtable';

dotenv.config();

// Configure Airtable
Airtable.configure({
  endpointUrl: 'https://api.airtable.com',
  apiKey: process.env.AIRTABLE_BEARER_TOKEN,
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

const app = express();
app.use(bodyParser.json());
app.use(morgan("combined"));
app.use(express.static('static')); // Serve static files

const apiKey = process.env.OPENAI_API_KEY;
const assistant_id = process.env.ASSISTANT_ID;
const openai = new OpenAI({ apiKey: apiKey });

// Function to manage Airtable records
const manageAirtableRecord = async (sessionId, userMessage, assistantResponse) => {
  const threadId = `thread_${sessionId}`;
  const timestamp = new Date().toISOString();
  const messageContent = `[${timestamp}] User: ${userMessage}\n[${timestamp}] Assistant: ${assistantResponse}`;

  // Retrieve the record for the session if it exists
  const records = await base('Threads').select({
    filterByFormula: `{SessionID} = '${sessionId}'`
  }).firstPage();

  const existingRecord = records.length > 0 ? records[0] : null;

  if (existingRecord) {
    // Append the new message to the existing conversation
    const updatedConversation = `${existingRecord.fields.Conversation}\n${messageContent}`;

    // Update the existing record
    try {
      await base('Threads').update(existingRecord.id, {
        "Conversation": updatedConversation
      });
      console.log('Airtable record updated successfully.');
    } catch (error) {
      console.error('Error updating Airtable record:', error);
    }
  } else {
    // Create a new record
    try {
      await base('Threads').create([{
        fields: {
          "ThreadID": threadId,
          "Timestamp": timestamp,
          "SessionID": sessionId,
          "Message": userMessage,
          "Conversation": messageContent
        }
      }]);
      console.log('New Airtable record created successfully.');
    } catch (error) {
      console.error('Error creating Airtable record:', error);
    }
  }
};

// Endpoint to handle chat
app.post("/chat", async (req, res) => {
  try {
    if (!req.body.message) {
      return res.status(400).json({ error: "Message field is required" });
    }
    const userMessage = req.body.message;
    const sessionId = req.body.sessionId; // Make sure this is being sent from your client

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

    // Add or update conversation in Airtable
    manageAirtableRecord(sessionId, userMessage, response);

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
