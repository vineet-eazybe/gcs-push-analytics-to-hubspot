const express = require('express');
const { extractDataFromActiveUsers, processDataToBeSyncedWithHubspot, syncDataWithHubspot } = require('./helper');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(express.json());

// Route to get all active users
app.get('/active-users/conversation-summary', async (req, res) => {
    try {
        const conversationSummary = await extractDataFromActiveUsers();
        res.json({
            status: true,
            data: conversationSummary,
            message: 'Conversation summary retrieved successfully'
        });
    } catch (error) {
        console.error('Error in /active-users/conversation-summary route:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to retrieve conversation summary',
            error: error.message
        });
    }
});

app.get('/active-users/process-data-to-be-synced-with-hubspot', async (req, res) => {
    try {
        const data = await processDataToBeSyncedWithHubspot();
        res.json({
            status: true,
            data: data,
            message: 'Data to be synced with Hubspot retrieved successfully'
        });
    } catch (error) {
        console.error('Error in /active-users/process-data-to-be-synced-with-hubspot route:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to process data to be synced with Hubspot',
            error: error.message
        });
    }
});

app.get('/active-users/sync-data-with-hubspot', async (req, res) => {
    try {
        const data = await syncDataWithHubspot();
        res.json({
            status: true,
            data: data,
            message: 'Data synced with Hubspot successfully'
        });
    }
    catch (error) {
        console.error('Error in /active-users/sync-data-with-hubspot route:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to sync data with Hubspot',
            error: error.message
        });
    }
});

// Health check route
app.get('/health', (req, res) => {
    res.json({
        status: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Conversation summary: http://localhost:${PORT}/active-users/conversation-summary`);
    console.log(`Data to be synced with Hubspot: http://localhost:${PORT}/active-users/process-data-to-be-synced-with-hubspot`);
    console.log(`Sync data with Hubspot: http://localhost:${PORT}/active-users/sync-data-with-hubspot`);
});

module.exports = app;
