const axios = require('axios');

async function getAllHubspoActiveUsers() {
    try {
        const response = await axios.get('https://dev.eazybe.com/v2/hubspot/active-users', {
            headers: {
                'x-gcs-signature': '1234567890',
                'Content-Type': 'application/json'
            }
        });
        
        // console.log('Active users data:', response.data.data);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching active users:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = {
    getAllHubspoActiveUsers
};
