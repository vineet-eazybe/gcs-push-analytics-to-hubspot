const axios = require('axios');
const dotenv = require('dotenv');
const { generatePhoneNumberVariations } = require('./phoneNumberParsing');
dotenv.config();
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

async function refreshHubSpotToken(refreshToken) {
    try {
        const response = await axios.post('https://api.hubapi.com/oauth/v1/token', {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: process.env.HS_CLIENT_ID,
            client_secret: process.env.HS_CLIENT_SECRET
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        return {
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_in: response.data.expires_in
        };
    } catch (error) {
        console.error('Error refreshing HubSpot token:', error.response?.data || error.message);
        throw error;
    }
}

async function contactExistanceBulkOnHubspot(accessToken, phoneNumbers = [], refreshToken = null) {
    try {
        // Create a mapping of original phone numbers to their variations
        const phoneToVariationsMap = {};
        const allPhoneNumberVariations = [];
        
        phoneNumbers.forEach(phone => {
            if (phone && typeof phone === 'string') {
                const variations = generatePhoneNumberVariations(phone);
                phoneToVariationsMap[phone] = variations;
                allPhoneNumberVariations.push(...variations);
            }
        });
                
        if (allPhoneNumberVariations.length === 0) {
            return [];
        }
        
        // Split phone number variations into batches of 100
        const batches = [];
        for (let i = 0; i < allPhoneNumberVariations.length; i += 100) {
            batches.push(allPhoneNumberVariations.slice(i, i + 100));
        }
        
        console.log(`Processing ${batches.length} batches of phone number variations`);
        
        const allContacts = [];
        
        // Process each batch
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} phone variations`);
            
            // Define searchRequest outside try block so it's accessible in catch block
            const searchRequest = {
                filterGroups: [
                    {
                        filters: [
                            {
                                propertyName: "hs_searchable_calculated_phone_number",
                                operator: "IN",
                                values: batch
                            }
                        ]
                    },
                    {
                        filters: [
                            {
                                propertyName: "hs_searchable_calculated_mobile_number", 
                                operator: "IN",
                                values: batch
                            }
                        ]
                    },
                    {
                        filters: [
                            {
                                propertyName: "phone",
                                operator: "IN", 
                                values: batch
                            }
                        ]
                    },
                    {
                        filters: [
                            {
                                propertyName: "mobilephone",
                                operator: "IN",
                                values: batch
                            }
                        ]
                    },
                    {
                        filters: [
                            {
                                propertyName: "hs_whatsapp_phone_number",
                                operator: "IN",
                                values: batch
                            }
                        ]
                    }
                ],
                properties: [
                    "id",
                    "email", 
                    "firstname",
                    "lastname",
                    "phone",
                    "mobilephone",
                    "hs_searchable_calculated_phone_number",
                    "hs_searchable_calculated_mobile_number",
                    "hs_whatsapp_phone_number"
                ],
                limit: 100
            };
            
            try {
                const response = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', searchRequest, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.data.results && response.data.results.length > 0) {
                    allContacts.push(...response.data.results);
                    console.log(`Batch ${i + 1} found ${response.data.results.length} contacts`);
                } else {
                    console.log(`Batch ${i + 1} found 0 contacts`);
                }
                
                // Add delay between batches to avoid rate limiting
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (batchError) {
                console.error(`Error in batch ${i + 1}:`, batchError.message);
                if (batchError.response?.status === 401) {
                    console.error('Authentication failed - access token may be invalid or expired');
                    console.error('Response data:', batchError.response?.data);
                    
                    // Try to refresh token if refresh token is available
                    if (refreshToken) {
                        try {
                            console.log('Attempting to refresh access token...');
                            const newTokens = await refreshHubSpotToken(refreshToken);
                            console.log('Successfully refreshed access token');
                            
                            // Retry the current batch with new access token
                            const retryResponse = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', searchRequest, {
                                headers: {
                                    'Authorization': `Bearer ${newTokens.access_token}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (retryResponse.data.results && retryResponse.data.results.length > 0) {
                                allContacts.push(...retryResponse.data.results);
                                console.log(`Batch ${i + 1} (retry) found ${retryResponse.data.results.length} contacts`);
                            } else {
                                console.log(`Batch ${i + 1} (retry) found 0 contacts`);
                            }
                            
                            // Update access token for remaining batches
                            accessToken = newTokens.access_token;
                            
                        } catch (refreshError) {
                            console.error('Failed to refresh token:', refreshError.message);
                            throw batchError; // Re-throw original 401 error
                        }
                    } else {
                        console.error('No refresh token available');
                        throw batchError;
                    }
                } else {
                    // Continue with next batch for other errors
                    continue;
                }
            }
        }
        
        // Remove duplicate contacts based on ID
        const uniqueContacts = allContacts.reduce((acc, contact) => {
            if (!acc.find(c => c.id === contact.id)) {
                acc.push(contact);
            }
            return acc;
        }, []);
        
        // Create mapping of chat ID (phone number) to contact ID
        const chatIdToContactIdMap = {};
        
        // For each original phone number, check if any of its variations match found contacts
        phoneNumbers.forEach(originalPhone => {
            if (originalPhone && typeof originalPhone === 'string') {
                const variations = phoneToVariationsMap[originalPhone] || [];
                
                // Find contacts that match any variation of this phone number
                const matchingContacts = uniqueContacts.filter(contact => {
                    const contactPhones = [
                        contact.properties.phone,
                        contact.properties.mobilephone,
                        contact.properties.hs_searchable_calculated_phone_number,
                        contact.properties.hs_searchable_calculated_mobile_number,
                        contact.properties.hs_whatsapp_phone_number
                    ].filter(Boolean);
                    
                    // Check if any contact phone matches any variation
                    return variations.some(variation => 
                        contactPhones.some(contactPhone => 
                            contactPhone === variation || 
                            contactPhone.replace(/\D/g, '') === variation.replace(/\D/g, '')
                        )
                    );
                });
                
                if (matchingContacts.length > 0) {
                    // Use the first matching contact (you could modify this logic as needed)
                    chatIdToContactIdMap[originalPhone] = {
                        contactId: matchingContacts[0].id,
                        contact: matchingContacts[0]
                    };
                }
            }
        });
        
        console.log(`Total contacts found: ${allContacts.length}, Unique contacts: ${uniqueContacts.length}`);
        
        return {
            chatIdToContactIdMap: chatIdToContactIdMap
        };
    } catch (error) {
        console.error('Error checking contact existence bulk on Hubspot:', error.response?.data || error.message);
        throw error;
    }
}


/**
 * Update multiple HubSpot contacts in batch (up to 100 contacts)
 * @param {string} accessToken - HubSpot access token
 * @param {Array} contacts - Array of contact objects with id and properties
 * @returns {Object} Batch update response
 */
async function updateHubspotContactsBatch(accessToken, chatData) {
    try {
        // Split chatData into batches of 100
        const batchSize = 100;
        const batches = [];
        for (let i = 0; i < chatData.length; i += batchSize) {
            batches.push(chatData.slice(i, i + batchSize));
        }

        console.log(`Processing ${chatData.length} contacts in ${batches.length} batches of up to ${batchSize} contacts each`);

        let properties = {
            'eazybe_follow_ups': 0,
            'eazybe_messages_received': 0,
            'eazybe_messages_sent': 0,
            'eazybe_messages_you_got': 0,
            'eazybe_messages_you_sent': 0,
            'eazybe_total_messages': 0,
            'eazybe_first_response_time': 0,
            'eazybe_average_response_time': 0,
            'eazybe_time_since_last_client_message': 0,
            'eazybe_last_message_send_by': 0
        }

        const allResults = [];
        let totalUpdated = 0;

        // Process each batch
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} contacts`);

            try {
                const batchData = {
                    inputs: batch.map(chat => ({
                        id: chat.contactId,
                        properties: {
                            ...properties,
                            'eazybe_total_messages': chat.analytics.total_messages,
                            'eazybe_messages_received': chat.analytics.messages_received,
                            'eazybe_messages_sent': chat.analytics.messages_sent,
                            'eazybe_follow_ups': chat.analytics.number_of_follow_ups,
                            'eazybe_average_response_time': chat.average_response_time
                        }
                    }))
                };

                const response = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/batch/update', batchData, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                allResults.push(response.data);
                totalUpdated += batch.length;
                console.log(`Successfully updated ${batch.length} contacts in batch ${i + 1}`);

                // Add delay between batches to avoid rate limiting
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

            } catch (batchError) {
                console.error(`Error updating batch ${i + 1}:`, batchError.response?.data || batchError.message);
                // Continue with next batch instead of failing completely
                continue;
            }
        }

        console.log(`Successfully updated ${totalUpdated} out of ${chatData.length} contacts across ${batches.length} batches`);
        return {
            totalProcessed: chatData.length,
            totalUpdated: totalUpdated,
            batchesProcessed: batches.length,
            results: allResults
        };

    } catch (error) {
        console.error('Error updating HubSpot contacts in batch:', error.response?.data || error.message);
        throw error;
    }
}


module.exports = {
    getAllHubspoActiveUsers,
    refreshHubSpotToken,
    contactExistanceBulkOnHubspot,
    updateHubspotContactsBatch
};
