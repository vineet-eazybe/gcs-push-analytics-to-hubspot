const axios = require('axios');
const dotenv = require('dotenv');
const { generatePhoneNumberVariations } = require('./phoneNumberParsing');
const { logWebhookSiteConfig } = require('./webhookSiteConfig');
const { retryWithBackoff } = require('./utils');
dotenv.config();

async function contactExistanceBulkOnHubspot(accessToken, phoneNumbers = []) {
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
                // Log the search request
                logWebhookSiteConfig({
                    operation: 'HubSpot Contact Search',
                    batch: `${i + 1}/${batches.length}`,
                    phoneCount: batch.length,
                    searchRequest: searchRequest
                });

                const response = await retryWithBackoff(async () => await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', searchRequest, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }));
                
                if (response.data.results && response.data.results.length > 0) {
                    allContacts.push(...response.data.results);
                    console.log(`Batch ${i + 1} found ${response.data.results.length} contacts`);
                    
                    // Log the search response
                    logWebhookSiteConfig({
                        operation: 'HubSpot Contact Search Response',
                        batch: `${i + 1}/${batches.length}`,
                        foundContacts: response.data.results.length,
                        contacts: response.data.results
                    });
                } else {
                    console.log(`Batch ${i + 1} found 0 contacts`);
                }
                
                // Add delay between batches to avoid rate limiting
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (batchError) {
                console.error(`Error in batch ${i + 1}:`, batchError.message);
                console.error('Error details:', batchError.response?.data);
                // Continue with next batch
                continue;
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
 * Create custom properties in HubSpot if they don't exist
 * @param {string} accessToken - HubSpot access token
 * @returns {Promise} Result of property creation
 */
async function createHubspotCustomProperties(accessToken) {
    try {
        console.log('Creating custom properties in HubSpot...');
        
        // Single API call to get all contact properties
        const allPropertiesResponse = await axios.get('https://api.hubapi.com/crm/v3/properties/contacts', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const allProperties = allPropertiesResponse.data.results;

        // Check if the group exists
        const groupExists = allProperties.some(prop =>
            prop.groupName === 'eazybe_whatsapp_integration_properties'
        );

        if (groupExists) {
            // Check if all required properties exist in the group
            const requiredPropertyNames = [
                'eazybe_total_messages',
                'eazybe_messages_received',
                'eazybe_messages_sent',
                'eazybe_follow_ups',
                'eazybe_messages_you_got',
                'eazybe_messages_you_sent',
                'eazybe_first_response_time',
                'eazybe_average_response_time',
                'eazybe_time_since_last_client_message',
                'eazybe_last_message_send_by',
                'eazybe_client_replied'
            ];

            const existingProperties = allProperties.filter(prop =>
                prop.groupName === 'eazybe_whatsapp_integration_properties' &&
                requiredPropertyNames.includes(prop.name) &&
                !prop.archived
            );

            if (existingProperties.length === requiredPropertyNames.length) {
                console.log('✓ All properties already exist');
                return {
                    status: true,
                    status_code: 200,
                    data: {
                        message: "Properties Already Exists"
                    }
                };
            } else {
                // Create the extra properties which are missing for older users
                console.log('→ Group exists but some properties are missing, creating them...');
                
                try {
                    const properties = {
                        inputs: [
                            {
                                hidden: false,
                                label: "Total Messages",
                                type: "number",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_total_messages",
                                fieldType: "number"
                            },
                            {
                                hidden: false,
                                label: "Messages Received",
                                type: "number",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_messages_received",
                                fieldType: "number"
                            },
                            {
                                hidden: false,
                                label: "Messages Sent",
                                type: "number",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_messages_sent",
                                fieldType: "number"
                            },
                            {
                                hidden: false,
                                label: "Follow-ups",
                                type: "number",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_follow_ups",
                                fieldType: "number"
                            },
                            {
                                hidden: false,
                                label: "Messages you got",
                                type: "number",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_messages_you_got",
                                fieldType: "number"
                            },
                            {
                                hidden: false,
                                label: "Messages you sent",
                                type: "number",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_messages_you_sent",
                                fieldType: "number"
                            },
                            {
                                hidden: false,
                                label: "First Response Time",
                                type: "string",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_first_response_time",
                                fieldType: "text"
                            },
                            {
                                hidden: false,
                                label: "Average Response Time",
                                type: "string",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_average_response_time",
                                fieldType: "text"
                            },
                            {
                                hidden: false,
                                label: "Time Since Last Client Message",
                                type: "string",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_time_since_last_client_message",
                                fieldType: "text"
                            },
                            {
                                hidden: false,
                                label: "Last Message send by",
                                type: "string",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_last_message_send_by",
                                fieldType: "text"
                            },
                            {
                                hidden: false,
                                label: "Client Replied",
                                type: "string",
                                groupName: "eazybe_whatsapp_integration_properties",
                                name: "eazybe_client_replied",
                                fieldType: "text"
                            }
                        ]
                    };

                    await axios.post('https://api.hubapi.com/crm/v3/properties/contacts/batch/create', properties, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    console.log('✓ Missing properties created successfully');
                    return {
                        status: true,
                        status_code: 200,
                        data: {
                            message: "Group Already Exists but properties were not present so created them"
                        }
                    };
                } catch (error) {
                    console.error('✗ Error creating missing properties:', error.response?.data || error.message);
                    return {
                        status: false,
                        status_code: 500,
                        data: {
                            error: {
                                message: error.message
                            }
                        }
                    };
                }
            }
        }

        // If we reach here, the group doesn't exist so create it
        console.log('→ Group does not exist, creating group and properties...');
        
        const groupDetails = {
            name: 'eazybe_whatsapp_integration_properties',
            label: 'Eazybe Whatsapp Integration Properties',
            displayOrder: 1
        };

        try {
            await axios.post('https://api.hubapi.com/crm/v3/properties/contacts/groups', groupDetails, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('✓ Property group created');

            const properties = {
                inputs: [
                    {
                        hidden: false,
                        label: "Total Messages",
                        type: "number",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_total_messages",
                        fieldType: "number"
                    },
                    {
                        hidden: false,
                        label: "Messages Received",
                        type: "number",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_messages_received",
                        fieldType: "number"
                    },
                    {
                        hidden: false,
                        label: "Messages Sent",
                        type: "number",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_messages_sent",
                        fieldType: "number"
                    },
                    {
                        hidden: false,
                        label: "Follow-ups",
                        type: "number",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_follow_ups",
                        fieldType: "number"
                    },
                    {
                        hidden: false,
                        label: "Messages you got",
                        type: "number",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_messages_you_got",
                        fieldType: "number"
                    },
                    {
                        hidden: false,
                        label: "Messages you sent",
                        type: "number",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_messages_you_sent",
                        fieldType: "number"
                    },
                    {
                        hidden: false,
                        label: "First Response Time",
                        type: "string",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_first_response_time",
                        fieldType: "text"
                    },
                    {
                        hidden: false,
                        label: "Average Response Time",
                        type: "string",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_average_response_time",
                        fieldType: "text"
                    },
                    {
                        hidden: false,
                        label: "Time Since Last Client Message",
                        type: "string",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_time_since_last_client_message",
                        fieldType: "text"
                    },
                    {
                        hidden: false,
                        label: "Last Message send by",
                        type: "string",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_last_message_send_by",
                        fieldType: "text"
                    },
                    {
                        hidden: false,
                        label: "Client Replied",
                        type: "string",
                        groupName: "eazybe_whatsapp_integration_properties",
                        name: "eazybe_client_replied",
                        fieldType: "text"
                    }
                ]
            };

            await axios.post('https://api.hubapi.com/crm/v3/properties/contacts/batch/create', properties, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('✓ Properties created successfully');
            
            return {
                status: true,
                status_code: 200,
                data: {
                    message: "Group and properties created successfully"
                }
            };
        } catch (error) {
            console.error('✗ Error creating group and properties:', error.response?.data || error.message);
            return {
                status: false,
                status_code: 500,
                data: {
                    error: {
                        message: error.message
                    }
                }
            };
        }
    } catch (err) {
        console.error('✗ Error in createHubspotCustomProperties:', err.response?.data || err.message);
        return {
            status: false,
            status_code: 500,
            data: {
                error: {
                    message: err.message
                }
            }
        };
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
        // Remove duplicate contact IDs to avoid HubSpot validation errors
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
            'eazybe_last_message_send_by': 0,
            'eazybe_client_replied': ''
        }

        const allResults = [];
        let totalUpdated = 0;
        let propertiesCreated = false;

        // Process each batch
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} contacts`);

            // Define batchData outside try block so it's accessible in catch block
            const batchData = {
                inputs: batch.map(chat => ({
                    id: chat.contactId,
                    properties: {
                        ...properties,
                        'eazybe_total_messages': chat.analytics.total_messages,
                        'eazybe_messages_received': chat.analytics.messages_received,
                        'eazybe_messages_sent': chat.analytics.messages_sent,
                        'eazybe_follow_ups': chat.analytics.number_of_follow_ups,
                        'eazybe_average_response_time': chat.average_response_time,
                        'eazybe_last_message_send_by': chat.last_message_from === "contact" ? "Client" : "Employee",
                        'eazybe_first_response_time': chat.first_response_time,
                        'eazybe_time_since_last_client_message': chat.time_since_last_client_message,
                        'eazybe_client_replied': chat.client_replied || (chat.analytics.messages_received > 0 ? "Yes" : "No")
                    }
                }))
            };

            try {
                // Log the batch update request
                logWebhookSiteConfig({
                    operation: 'HubSpot Batch Update Request',
                    batch: `${i + 1}/${batches.length}`,
                    contactCount: batch.length,
                    batchData: batchData
                });

                const response = await retryWithBackoff(async () => await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/batch/update', batchData, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }));

                allResults.push(response.data);
                totalUpdated += batch.length;
                console.log(`Successfully updated ${batch.length} contacts in batch ${i + 1}`);

                // Log the batch update response
                logWebhookSiteConfig({
                    operation: 'HubSpot Batch Update Response',
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
                
                // Check if the error is due to missing properties
                const errorData = batchError.response?.data;
                const isMissingPropertyError = errorData?.category === 'VALIDATION_ERROR' && 
                    errorData?.errors?.some(err => err.code === 'PROPERTY_DOESNT_EXIST');
                
                if (isMissingPropertyError && !propertiesCreated) {
                    console.log('\n⚠️  Detected missing properties error. Creating custom properties in HubSpot...\n');
                    
                    try {
                        // Create the missing properties
                        await createHubspotCustomProperties(accessToken);
                        propertiesCreated = true;
                        
                        console.log('\n✓ Properties created successfully. Retrying batch update...\n');
                        
                        // Retry the current batch after creating properties
                        try {
                            const retryResponse = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/batch/update', batchData, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            allResults.push(retryResponse.data);
                            totalUpdated += batch.length;
                            console.log(`✓ Successfully updated ${batch.length} contacts in batch ${i + 1} after creating properties`);
                            
                            // Log the successful retry
                            logWebhookSiteConfig({
                                operation: 'HubSpot Batch Update Response (After Property Creation)',
                                batch: `${i + 1}/${batches.length}`,
                                updatedCount: batch.length,
                                response: retryResponse.data
                            });
                            
                        } catch (retryError) {
                            console.error(`✗ Failed to update batch ${i + 1} even after creating properties:`, retryError.response?.data || retryError.message);
                        }
                        
                    } catch (createError) {
                        console.error('✗ Failed to create custom properties:', createError.message);
                    }
                } else {
                    // For other errors, just log and continue
                    console.log(`Skipping batch ${i + 1} due to error`);
                }
                
                // Add delay before next batch
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        }

        console.log(`Successfully updated ${totalUpdated} out of ${uniqueChatData.length} contacts across ${batches.length} batches`);

        logWebhookSiteConfig({
            operation: 'HubSpot Batch Update Response',
            totalUpdated: totalUpdated,
            totalProcessed: uniqueChatData.length,
            batchesProcessed: batches.length,
            results: allResults
        });

        return {
            totalProcessed: uniqueChatData.length,
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
    contactExistanceBulkOnHubspot,
    updateHubspotContactsBatch,
    createHubspotCustomProperties
};
