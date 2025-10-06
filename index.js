const express = require('express');
const { getAllHubspoActiveUsers } = require('./helper');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(express.json());

// Route to get all active users
app.get('/active-users', async (req, res) => {
    try {
        const activeUsers = await getAllHubspoActiveUsers();
        res.json({
            status: true,
            data: activeUsers,
            message: 'Active users retrieved successfully'
        });
    } catch (error) {
        console.error('Error in /active-users route:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to retrieve active users',
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
    console.log(`Active users: http://localhost:${PORT}/active-users`);
});

module.exports = app;
