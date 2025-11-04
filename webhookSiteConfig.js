const axios = require('axios');


logWebhookSiteConfig = async (data) => {
    try {
        const response = await axios.post('https://webhook.site/analytics-to-crm', {
            data: data
        });
        console.log(response.data);
    } catch (error) {
        console.error('Error in logWebhookSiteConfig:', error);
    }
}

logWebhookSiteConfig({
    message: 'Hello, world!'
});