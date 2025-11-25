/**
 * Retry a function with exponential backoff
 * @param {Function} func - The async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} delay - Initial delay in milliseconds (default: 1000)
 * @returns {Promise} The result of the function call
 */
async function retryWithBackoff(func, maxRetries = 3, delay = 1000) {
    let retries = 0;
    let lastError;
    
    while (retries < maxRetries) {
        try {
            return await func();
        } catch (error) {
            lastError = error;
            retries++;
            
            if (retries >= maxRetries) {
                // We've exhausted all retries, throw the last error
                console.error(`Failed after ${maxRetries} retries:`, error.message);
                throw error;
            }
            
            // Calculate exponential backoff delay
            const backoffDelay = delay * Math.pow(2, retries - 1);
            console.log(`Retry ${retries}/${maxRetries} after ${backoffDelay}ms delay...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
    }
    
    // This should never be reached, but just in case
    throw lastError || new Error('Max retries reached');
}

module.exports = {
    retryWithBackoff
};

