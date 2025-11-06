const axios = require('axios');
const dotenv = require('dotenv');
const { generatePhoneNumberVariations } = require('./phoneNumberParsing');
const { logWebhookSiteConfig } = require('./webhookSiteConfig');
dotenv.config();

/**
 * Get all fields for Contacts module in Zoho
 * @param {string} accessToken - Zoho access token
 * @param {string} apiDomain - Zoho API domain
 */
async function getZohoContactFields(accessToken, apiDomain = 'https://www.zohoapis.com') {
    try {
        const response = await axios.get(`${apiDomain}/crm/v2/settings/fields?module=Contacts`, {
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        // Filter to only show custom fields related to analytics
        const analyticsFields = response.data.fields.filter(field => 
            field.api_name && (
                field.api_name.toLowerCase().includes('message') ||
                field.api_name.toLowerCase().includes('response') ||
                field.api_name.toLowerCase().includes('follow') ||
                field.api_name.toLowerCase().includes('interaction') ||
                field.api_name.toLowerCase().includes('client') ||
                field.api_name.toLowerCase().includes('avg') ||
                field.api_name.toLowerCase().includes('inbound') ||
                field.api_name.toLowerCase().includes('outbound')
            )
        );
        
        console.log('\n========== ZOHO ANALYTICS FIELDS ==========');
        analyticsFields.forEach(field => {
            console.log(`Field: ${field.field_label}`);
            console.log(`  API Name: ${field.api_name}`);
            console.log(`  Data Type: ${field.data_type}`);
            console.log(`  Custom: ${field.custom_field || false}`);
            console.log('---');
        });
        console.log('==========================================\n');
        
        return analyticsFields;
    } catch (error) {
        console.error('Error fetching Zoho fields:', error.response?.data || error.message);
        throw error;
    }
}

async function contactExistanceBulkOnZoho(accessToken, phoneNumbers = [], apiDomain = 'https://www.zohoapis.com') {
    try {
        if (phoneNumbers.length === 0) {
            return { chatIdToContactIdMap: {} };
        }
        
        // Create a mapping of original phone numbers to their variations
        const phoneToVariationsMap = {};
        phoneNumbers.forEach(phone => {
            if (phone && typeof phone === 'string') {
                const variations = generatePhoneNumberVariations(phone);
                phoneToVariationsMap[phone] = variations;
            }
        });
        
        const chatIdToContactIdMap = {};
        const allFoundContacts = [];
        
        // Process phones in chunks of 5 (as per Zoho's composite API best practices)
        const chunkSize = 5;
        const chunks = Math.ceil(phoneNumbers.length / chunkSize);
        
        console.log(`Processing ${phoneNumbers.length} phone numbers in ${chunks} chunks`);
        
        for (let i = 0; i < chunks; i++) {
            const chunkStart = i * chunkSize;
            const chunkEnd = Math.min((i + 1) * chunkSize, phoneNumbers.length);
            const phoneChunk = phoneNumbers.slice(chunkStart, chunkEnd);
            
            console.log(`Processing chunk ${i + 1}/${chunks} with ${phoneChunk.length} phone numbers`);
            
            // Build composite requests for Phone and Mobile fields
            const compositeRequests = [];
            const phoneToRequestIndexMap = {};
            
            phoneChunk.forEach((phone, idx) => {
                const variations = phoneToVariationsMap[phone] || [];
                if (variations.length === 0) return;
                
                // Create criteria for both Phone and Mobile fields
                const phoneVariationsStr = variations.join(',');
                const criteria = `(Phone:in:${phoneVariationsStr}) or (Mobile:in:${phoneVariationsStr})`;
                
                compositeRequests.push({
                    method: "GET",
                    uri: `/crm/v2/Contacts/search`,
                    params: { criteria }
                });
                
                phoneToRequestIndexMap[compositeRequests.length - 1] = phone;
            });
            
            if (compositeRequests.length === 0) {
                console.log(`Chunk ${i + 1} has no valid phone numbers, skipping`);
                continue;
            }
            
            try {
                const response = await axios.post(
                    `${apiDomain}/crm/v6/__composite_requests`,
                    {
                        rollback_on_fail: false,
                        parallel_execution: false,
                        __composite_requests: compositeRequests
                    },
                    {
                        headers: {
                            'Authorization': `Zoho-oauthtoken ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                // Process composite response
                if (response.data?.__composite_requests) {
                    response.data.__composite_requests.forEach((compositeResponse, idx) => {
                        const originalPhone = phoneToRequestIndexMap[idx];
                        
                        if (
                            compositeResponse.details?.response?.status_code === 200 &&
                            compositeResponse.details?.response?.body?.data?.length > 0
                        ) {
                            const contactData = compositeResponse.details.response.body.data[0];
                            
                            // Store the contact
                            allFoundContacts.push(contactData);
                            
                            // Map the original phone to the contact
                            chatIdToContactIdMap[originalPhone] = {
                                contactId: contactData.id,
                                contact: contactData
                            };
                            
                            console.log(`Found contact for phone ${originalPhone}: ${contactData.id}`);
                        }
                    });
                }
                
                console.log(`Chunk ${i + 1} completed: ${Object.keys(chatIdToContactIdMap).length} total contacts found so far`);
                
                // Add delay between chunks to avoid rate limiting
                if (i < chunks - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (chunkError) {
                console.error(`Error in chunk ${i + 1}:`, chunkError.message);
                console.error('Error details:', chunkError.response?.data);
                // Continue with next chunk
                continue;
            }
        }
        
        console.log(`Total contacts found: ${allFoundContacts.length}, Total mapped: ${Object.keys(chatIdToContactIdMap).length}`);
        
        return {
            chatIdToContactIdMap: chatIdToContactIdMap
        };
    } catch (error) {
        console.error('Error checking contact existence bulk on Zoho:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Update multiple Zoho contacts in batch (up to 100 contacts)
 * @param {string} accessToken - Zoho access token
 * @param {Array} contacts - Array of contact objects with id and properties
 * @returns {Object} Batch update response
 */
async function updateZohoContactsBatch(accessToken, chatData, apiDomain = 'https://www.zohoapis.com') {
    try {
        // Remove duplicate contact IDs to avoid Zoho validation errors
        const uniqueChatData = chatData.reduce((acc, chat) => {
            if (!acc.find(c => c.contactId === chat.contactId)) {
                acc.push(chat);
            }
            return acc;
        }, []);

        console.log(`Removed ${chatData.length - uniqueChatData.length} duplicate contacts. Processing ${uniqueChatData.length} unique contacts.`);

        // Split chatData into batches of 100
        const batchSize = 100;
        const batches = [];
        for (let i = 0; i < uniqueChatData.length; i += batchSize) {
            batches.push(uniqueChatData.slice(i, i + batchSize));
        }

        console.log(`Processing ${uniqueChatData.length} contacts in ${batches.length} batches of up to ${batchSize} contacts each`);

        const allResults = [];
        let totalUpdated = 0;

        // Process each batch
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} contacts`);

            // Define batchData outside try block so it's accessible in catch block
            const batchData = {
                data: batch.map(chat => {
                    // Parse analytics if it's a JSON string
                    let analytics = chat.analytics;
                    if (typeof analytics === 'string') {
                        try {
                            analytics = JSON.parse(analytics);
                        } catch (e) {
                            console.error('Error parsing analytics JSON:', e.message);
                            analytics = {};
                        }
                    }
                    // Ensure analytics is an object
                    if (!analytics || typeof analytics !== 'object') {
                        analytics = {};
                    }
                    
                    // Helper function to safely parse date
                    const parseDate = (dateValue) => {
                        if (!dateValue) return null;
                        try {
                            // Handle BigQuery timestamp format (object with value property)
                            if (dateValue && typeof dateValue === 'object' && dateValue.value) {
                                dateValue = dateValue.value;
                            }
                            const date = new Date(dateValue);
                            return isNaN(date.getTime()) ? null : date;
                        } catch (e) {
                            console.error('Error parsing date:', dateValue, e.message);
                            return null;
                        }
                    };
                    
                    // Calculate time since last client message (in hours)
                    let timeSinceLastMessage = null;
                    const updatedDate = parseDate(chat.updated_at);
                    if (updatedDate) {
                        timeSinceLastMessage = Math.floor((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60));
                    }
                    
                    // Format average response time for display (convert minutes to hours)
                    const avgResponseTimeText = chat.average_response_time 
                        ? `${(chat.average_response_time / 60).toFixed(2)} hours`
                        : 'N/A';
                    
                    // Format last interaction date
                    const lastInteractionDate = updatedDate ? updatedDate.toISOString().split('T')[0] : null;
                    
                    return {
                        id: chat.contactId,
                        // Use exact API names from Zoho
                        messagesreceived: parseInt(analytics.messages_received) || 0,
                        messagessent: parseInt(analytics.messages_sent) || 0,
                        totalmessages: parseInt(analytics.total_messages) || 0,
                        Follow_ups_Count: parseInt(analytics.number_of_follow_ups) || 0,
                        Last_Interaction_Date: lastInteractionDate,
                        Average_Response_Time: avgResponseTimeText,
                        Time_Since_Last_Client_Message: timeSinceLastMessage ? `${timeSinceLastMessage} hours ago` : 'N/A',
                        First_Response_Time: 'N/A',  // Not available in current data
                        Last_Message_send_by: 'N/A'  // Not available in current data
                    };
                })
            };

            try {
                // Log the batch update request
                logWebhookSiteConfig({
                    operation: 'Zoho Batch Update Request',
                    batch: `${i + 1}/${batches.length}`,
                    contactCount: batch.length,
                    batchData: batchData
                });

                const response = await axios.put(`${apiDomain}/crm/v2/Contacts`, batchData, {
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                allResults.push(response.data);
                totalUpdated += batch.length;
                console.log(`Successfully updated ${batch.length} contacts in batch ${i + 1}`);

                // Log the batch update response
                logWebhookSiteConfig({
                    operation: 'Zoho Batch Update Response',
                    batch: `${i + 1}/${batches.length}`,
                    updatedCount: batch.length,
                    response: response.data
                });

                // Add delay between batches to avoid rate limiting
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

            } catch (batchError) {
                console.error(`Error updating batch ${i + 1}:`, batchError.response?.data || batchError.message);
                // Continue with next batch
                continue;
            }
        }

        console.log(`Successfully updated ${totalUpdated} out of ${uniqueChatData.length} contacts across ${batches.length} batches`);
        
        // Log final summary
        logWebhookSiteConfig({
            operation: 'Zoho Batch Update Complete',
            summary: {
                totalProcessed: uniqueChatData.length,
                totalUpdated: totalUpdated,
                batchesProcessed: batches.length,
                successRate: `${((totalUpdated / uniqueChatData.length) * 100).toFixed(2)}%`
            },
            timestamp: new Date().toISOString()
        });
        
        return {
            totalProcessed: uniqueChatData.length,
            totalUpdated: totalUpdated,
            batchesProcessed: batches.length,
            results: allResults
        };

    } catch (error) {
        console.error('Error updating Zoho contacts in batch:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = {
    contactExistanceBulkOnZoho,
    updateZohoContactsBatch
};
