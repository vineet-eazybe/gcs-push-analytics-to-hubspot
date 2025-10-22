const axios = require('axios');
const { BigQuery } = require('@google-cloud/bigquery');
const { contactExistanceBulkOnHubspot, getAllHubspoActiveUsers, updateHubspotContactsBatch } = require('./hubspot');

const bigquery = new BigQuery({
    credentials: require('./gcp-key.json')
});


// Helper function to split array into batches
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

async function extractDataFromActiveUsers(batchSize = 25) {
    try {
        const {activeUsersWithScalerPlan} = await getAllHubspoActiveUsers();

        // activeUsers is an array of objects with the following structure:
        // {
        //     workspace_id: string,
        //     access_token: string,
        //     refresh_token: string
        // }

        console.log(`Processing ${activeUsersWithScalerPlan.length} active users in batches of ${batchSize}`);

        // Split active users into batches
        const userBatches = chunkArray(activeUsersWithScalerPlan, batchSize);
        const allResults = [];

        // Process each batch with better memory management
        for (let i = 0; i < userBatches.length; i++) {
            const batch = userBatches[i];
            console.log(`Processing batch ${i + 1}/${userBatches.length} with ${batch.length} users`);
            
            try {
                // Create a more efficient query using parameterized queries
                // Ensure workspace_ids are strings to match the uid column type
                const workspaceIds = batch.map(user => String(user.workspace_id));
                
                const query = {
                    query: `
                        SELECT 
                            uid,
                            org_id,
                            chat_id,
                            analytics,
                            average_response_time,
                            created_at,
                            updated_at
                        FROM \`waba-454907.whatsapp_analytics.conversation_summary\`
                        WHERE uid IN UNNEST(@workspace_ids)
                        AND chat_id NOT LIKE '%missing%' AND chat_id NOT LIKE '%@g.us%'
                    `,
                    params: {
                        workspace_ids: workspaceIds
                    }
                };
                
                const [rows] = await bigquery.query(query);
                
                // Process results in smaller chunks to avoid memory issues
                if (rows.length > 0) {
                    allResults.push(...rows);
                    console.log(`Batch ${i + 1} completed: ${rows.length} records found`);
                } else {
                    console.log(`Batch ${i + 1} completed: No records found`);
                }
                
                // Clear the rows array to free memory
                rows.length = 0;
                
                // Add a longer delay between batches to avoid overwhelming BigQuery
                if (i < userBatches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
            } catch (batchError) {
                console.error(`Error in batch ${i + 1}:`, batchError.message);
                // Continue with next batch instead of failing completely
                continue;
            }
        }

        console.log(`Total records retrieved: ${allResults.length}`);
        return {
            conversationSummary: allResults,
            activeHubspotUsers: activeUsersWithScalerPlan
        };
        
    } catch (error) {
        console.error('Error extracting data from active users:', error.response?.data || error.message);
        throw error;
    }
}

async function processDataToBeSyncedWithHubspot() {
    try {
        const { conversationSummary, activeHubspotUsers } = await extractDataFromActiveUsers();
        
        // Create maps of workspace_id to tokens for quick lookup
        const accessTokenMap = activeHubspotUsers.reduce((acc, user) => {
            acc[user.workspace_id] = user.access_token;
            return acc;
        }, {});
        
        const refreshTokenMap = activeHubspotUsers.reduce((acc, user) => {
            acc[user.workspace_id] = user.refresh_token;
            return acc;
        }, {});
        
        // Group conversation summary by uid - each uid will contain all chats for that user
        const conversationSummaryByUid = conversationSummary.reduce((acc, curr) => {
            if (!acc[curr.uid]) {
                acc[curr.uid] = {
                    uid: curr.uid,
                    org_id: curr.org_id,
                    access_token: accessTokenMap[curr.uid] || null,
                    refresh_token: refreshTokenMap[curr.uid] || null,
                    chats: []
                };
            }
            acc[curr.uid].chats.push({
                chat_id: curr.chat_id,
                analytics: curr.analytics,
                average_response_time: curr.average_response_time,
                created_at: curr.created_at,
                updated_at: curr.updated_at
            });
            return acc;
        }, {});
        
        // Convert to array format
        const conversationSummaryArray = Object.values(conversationSummaryByUid);
        
        // Process each conversation to add contactId information
        try {
            for (const conversation of conversationSummaryArray) {
                if (conversation.access_token) {
                    console.log('fetching hubspot contacts for uid: ', conversation.uid);
                    
                    try {
                        const result = await contactExistanceBulkOnHubspot(
                            conversation.access_token, 
                            conversation.chats.map(chat => chat.chat_id.split('@')[0]),
                            conversation.refresh_token
                        );
                        
                        console.log('Found contacts:', Object.keys(result.chatIdToContactIdMap).length);
                        
                        // Add contactId to each chat in the conversation
                        conversation.chats.forEach(chat => {
                            const phoneNumber = chat.chat_id.split('@')[0];
                            const contactInfo = result.chatIdToContactIdMap[phoneNumber];
                            chat.contactId = contactInfo ? contactInfo.contactId : null;
                        });
                        
                    } catch (error) {
                        console.error('Error for UID', conversation.uid, ':', error.message);
                        if (error.response?.status === 401) {
                            console.error('Authentication failed - access token may be invalid or expired');
                        }
                        
                        // Set contactId to null for all chats in this conversation if there's an error
                        conversation.chats.forEach(chat => {
                            chat.contactId = null;
                        });
                    }
                } else {
                    // Set contactId to null for all chats if no access token
                    conversation.chats.forEach(chat => {
                        chat.contactId = null;
                    });
                }
            }
        } catch (error) {
            console.error('Error fetching hubspot contacts:', error.response?.data || error.message);
            throw error;
        }
        
        // Return the modified conversationSummaryArray with contactId information
        return conversationSummaryArray;


    } catch (error) {
        console.error('Error processing data to be processed:', error.response?.data || error.message);
        throw error;
    }
}

async function syncDataWithHubspot() {
    try {
        const conversationSummaryArray = await processDataToBeSyncedWithHubspot();
        
        for (const conversation of conversationSummaryArray) {
            if (conversation.access_token && conversation.chats.length > 0) {
                // Filter chats that have contactId
                const chatsWithContacts = conversation.chats.filter(chat => chat.contactId);
                
                if (chatsWithContacts.length > 0) {
                    console.log(`Syncing ${chatsWithContacts.length} contacts for UID: ${conversation.uid}`);
                    
                    // Prepare contacts for batch update
                    const contactsToUpdate = chatsWithContacts.map(chat => ({
                        id: chat.contactId,
                        properties: {
                            // Map to the property names expected by updateHubspotContactsBatch
                            last_whatsapp_interaction: chat.updated_at,
                            whatsapp_chat_id: chat.chat_id,
                            average_response_time: chat.average_response_time
                        }
                    }));
                    
                    try {
                        await updateHubspotContactsBatch(conversation.access_token, chatsWithContacts, conversation.refresh_token);
                        console.log(`Successfully synced ${chatsWithContacts.length} contacts for UID: ${conversation.uid}`);
                    } catch (error) {
                        console.error(`Error syncing contacts for UID ${conversation.uid}:`, error.message);
                        // Continue with next conversation instead of failing completely
                        continue;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error syncing data with Hubspot:', error.response?.data || error.message);
        throw error;
    }
}


module.exports = {
    extractDataFromActiveUsers,
    processDataToBeSyncedWithHubspot,
    syncDataWithHubspot
};
