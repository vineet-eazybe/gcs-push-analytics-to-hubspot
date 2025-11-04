const express = require('express');
const { extractDataFromActiveUsers, processDataToBeSyncedWithHubspot, processDataToBeSyncedWithZoho, syncDataWithHubspot, syncDataWithZoho } = require('./helper');

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

app.get('/active-users/process-data-to-be-synced', async (req, res) => {
    try {
        if (!req.query.crm) {
            return res.status(400).json({
                status: false,
                message: 'Missing required query parameter: crm (expected: hubspot or zoho)'
            });
        }
        let crm = req.query.crm.toLowerCase();
        if (crm === 'hubspot') {
            const data = await processDataToBeSyncedWithHubspot();
            res.json({
                status: true,
                data: data,
                message: 'Data to be synced with Hubspot retrieved successfully'
            });
        } else if (crm === 'zoho') {
            const data = await processDataToBeSyncedWithZoho();
            res.json({
                status: true,
                data: data,
                message: 'Data to be synced with Zoho retrieved successfully'
            });
        }
    } catch (error) {
        console.error('Error in /active-users/process-data-to-be-synced route:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to process data to be synced',
            error: error.message
        });
    }
});

app.get('/active-users/sync-data', async (req, res) => {
    try {
        if (!req.query.crm) {
            return res.status(400).json({
                status: false,
                message: 'Missing required query parameter: crm (expected: hubspot or zoho)'
            });
        }
        let crm = req.query.crm.toLowerCase();
        if (crm === 'hubspot') {
            const data = await syncDataWithHubspot();
        } 
        if (crm === 'zoho') {
            const data = await syncDataWithZoho();
        }
        return res.json({
            status: true,
            message: 'Data synced successfully'
        });

    }
    catch (error) {
        console.error('Error in /active-users/sync-data route:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to sync data',
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
    console.log(`Data to be synced with Zoho: http://localhost:${PORT}/active-users/process-data-to-be-synced-with-zoho`);
    console.log(`Sync data with Zoho: http://localhost:${PORT}/active-users/sync-data-with-zoho`);
});

module.exports = app;
