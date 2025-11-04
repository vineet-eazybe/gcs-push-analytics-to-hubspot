const axios = require('axios');

const webhookSiteUrl = 'https://webhook.site/analytics-to-crm';

logWebhookSiteConfig = async (data) => {
    try {
        const response = await axios.post(webhookSiteUrl, {
            data: data
        });
        // console.log(response.data);
    } catch (error) {
        console.error('Error in logWebhookSiteConfig:', error);
    }
}

module.exports = {
    logWebhookSiteConfig
}