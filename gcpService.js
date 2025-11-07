const express = require('express');
const dotenv = require('dotenv');
const { logWebhookSiteConfig } = require('./webhookSiteConfig');
const app = express();
dotenv.config();
// Configuration flags for enabling/disabling CRM syncs
const ENABLE_HUBSPOT_SYNC = process.env.ENABLE_HUBSPOT_SYNC !== 'false';
const ENABLE_ZOHO_SYNC = process.env.ENABLE_ZOHO_SYNC !== 'false';

// Main handler function
async function handleSync(req, res) {
    try {
        // Lazy load the helper to avoid blocking server startup
        const { syncDataWithHubspot, syncDataWithZoho } = require('./helper');
        
        console.log('Starting sync process...');
        console.log(`HubSpot sync: ${ENABLE_HUBSPOT_SYNC ? 'enabled' : 'disabled'}`);
        console.log(`Zoho sync: ${ENABLE_ZOHO_SYNC ? 'enabled' : 'disabled'}`);
        
        logWebhookSiteConfig({
            message: 'Starting sync process...',
            data: {
                hubspotSync: ENABLE_HUBSPOT_SYNC,
                zohoSync: ENABLE_ZOHO_SYNC
            }
        });
        const startTime = Date.now();
        
        // Prepare sync promises based on enabled flags
        const syncPromises = [];
        const syncNames = [];
        
        if (ENABLE_HUBSPOT_SYNC) {
            syncPromises.push(syncDataWithHubspot());
            syncNames.push('hubspot');
        }
        
        if (ENABLE_ZOHO_SYNC) {
            syncPromises.push(syncDataWithZoho());
            syncNames.push('zoho');
        }
        
        // If no syncs are enabled, return early
        if (syncPromises.length === 0) {
            console.log('No CRM syncs enabled');
            return res.status(200).json({
                status: true,
                message: 'No CRM syncs enabled',
                results: {
                    hubspot: 'disabled',
                    zoho: 'disabled'
                }
            });
        }
        
        // Run enabled syncs in parallel
        const results = await Promise.allSettled(syncPromises);
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        console.log(`Sync completed in ${duration} seconds`);
        
        // Map results back to CRM names
        const hubspotResult = ENABLE_HUBSPOT_SYNC ? 
            results[syncNames.indexOf('hubspot')] : 
            { status: 'disabled' };
        const zohoResult = ENABLE_ZOHO_SYNC ? 
            results[syncNames.indexOf('zoho')] : 
            { status: 'disabled' };
        
        console.log('HubSpot sync:', hubspotResult.status);
        console.log('Zoho sync:', zohoResult.status);
        
        // Check if any sync failed
        const errors = [];
        if (hubspotResult.status === 'rejected') {
            errors.push({ crm: 'HubSpot', error: hubspotResult.reason.message });
        }
        if (zohoResult.status === 'rejected') {
            errors.push({ crm: 'Zoho', error: zohoResult.reason.message });
        }
        
        return res.status(200).json({
            status: true,
            message: 'Data sync process completed',
            duration: `${duration} seconds`,
            results: {
                hubspot: hubspotResult.status,
                zoho: zohoResult.status
            },
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Error in main:', error);
        return res.status(500).json({
            status: false,
            message: 'Error in processor',
            error: error.message,
            stack: error.stack
        });
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Route for the sync endpoint
app.get('/', handleSync);
app.post('/', handleSync);

// Export for Functions Framework (for Cloud Functions)
exports.main = handleSync;

// Start server for Cloud Run (listens on PORT environment variable)
if (require.main === module) {
    const PORT = process.env.PORT || 8080;
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on port ${PORT}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM signal received: closing HTTP server');
        server.close(() => {
            console.log('HTTP server closed');
        });
    });
}
